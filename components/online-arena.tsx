'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import DailyIframe, {
  type DailyCall,
  type DailyEventObjectAppMessage,
} from '@daily-co/daily-js'
import { supabaseBrowser } from '@/lib/supabase'
import { Button, buttonClasses } from '@/components/ui/button'
import { TurnRing } from '@/components/turn-ring'
import VerdictPanel, { VerdictNextStep } from '@/components/verdict-panel'
import {
  ROUND_ORDER,
  ROUND_COPY,
  HANDOFF_BREAK_SECONDS,
  SECTION_BREAK_SECONDS,
  SILENT_TURN_TEXT,
  ABANDON_GRACE_SECONDS,
  moderationNoticeText,
  type RoundEntry,
  type RoundName,
  type Verdict,
  type HumanSpeaker,
  type VersusConfig,
  type ModerationAction,
} from '@/lib/debate'
import { EVENTS, capture } from '@/lib/analytics'
import { Circle, Square } from '@phosphor-icons/react/dist/ssr'

type Debate = {
  id: string
  user_id: string
  topic_text: string
  user_side: string | null
  status: string
  rounds: RoundEntry[] | null
  verdict: Verdict | null
  points_earned: number | null
  opponent_points_earned: number | null
  versus: Partial<VersusConfig> | null
  share_revoked: boolean | null
  share_receipts: boolean | null
  share_name: boolean | null
}

// THE ONLINE ARENA: ranked Human vs Human over a live Daily video call.
//
// Each player runs this component on their own device. The shape of a match
// mirrors the same-device VersusArena (six turns, coin-flip leader, breaks,
// background transcription, in-order submission), with three big differences:
//   1. A live Daily call carries the video/audio between the players. The call
//      is never recorded — only your OWN mic audio is captured per turn (off
//      Daily's local track) and sent to the existing transcribe route.
//   2. Turn choreography is synchronized over Daily app-messages (ready /
//      turn-start / turn-done / judged), with a DB poll as the safety net.
//   3. It's ranked: the verdict moves points (winner +150 with rematch decay,
//      loser -25), W/L, streaks, badges, and the H2H ledger, all server-side.
//
// Disconnects: if the opponent leaves the room, an overlay counts down the
// grace window while the server (via /api/debate/abandon + Daily's presence
// API) decides void vs forfeit. Nothing about the outcome trusts this client.

type Phase =
  | 'connecting'
  | 'lobby'
  | 'tipoff'
  | 'countdown'
  | 'speaking'
  | 'handoff'
  | 'wrapup'
  | 'judging'
  | 'verdict'
  | 'void'

type SlotStatus =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'ready'
  | 'submitting'
  | 'submitted'
  | 'failed'
  | 'theirs' // opponent's turn: their client submits it

type Slot = {
  status: SlotStatus
  text?: string
  blob?: Blob
  redacted?: boolean
  discarded?: boolean
}

type Msg =
  | { t: 'hello'; seat: HumanSpeaker; ready: boolean }
  | { t: 'ready'; seat: HumanSpeaker }
  | { t: 'turn-start'; idx: number }
  | { t: 'turn-done'; idx: number }
  | { t: 'judged' }
  | { t: 'flagged' }

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return undefined
}

const fmtClock = (s: number) =>
  `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`

const TIPOFF_SECONDS = 6
// Listener slack past the speaker's clock before we assume trouble.
const LISTEN_SLACK_SECONDS = 8

export default function OnlineArena({
  debate,
  hostName,
  viewerSeat,
  deepDiveUnlocked,
  isFounding = false,
}: {
  debate: Debate
  hostName: string
  viewerSeat: HumanSpeaker
  deepDiveUnlocked: boolean
  isFounding?: boolean
}) {
  const versus = debate.versus ?? {}
  const guestName = versus.guest_name?.trim() || 'The Challenger'
  const guestSide = versus.guest_side?.trim() || 'the other side'
  const hostSide = debate.user_side?.trim() || 'their side'
  const roomUrl = versus.room_url
  const turnSeconds =
    typeof versus.turn_seconds === 'number' && [60, 90, 120].includes(versus.turn_seconds)
      ? versus.turn_seconds
      : 120
  const first: HumanSpeaker = versus.first === 'guest' ? 'guest' : 'host'
  const second: HumanSpeaker = first === 'host' ? 'guest' : 'host'
  const otherSeat: HumanSpeaker = viewerSeat === 'host' ? 'guest' : 'host'

  const TURNS: { round: RoundName; speaker: HumanSpeaker }[] = ROUND_ORDER.flatMap((round) => [
    { round, speaker: first },
    { round, speaker: second },
  ])

  const nameOf = (s: HumanSpeaker) => (s === 'host' ? hostName : guestName)
  const sideOf = (s: HumanSpeaker) => (s === 'host' ? hostSide : guestSide)
  const breakAfter = (i: number) =>
    TURNS[i].round === TURNS[i + 1]?.round ? HANDOFF_BREAK_SECONDS : SECTION_BREAK_SECONDS

  // ── State ─────────────────────────────────────────────────────────
  const initialRounds = (debate.rounds ?? []) as RoundEntry[]
  const initialSubmitted = Math.min(initialRounds.length, 6)

  const [phase, setPhase] = useState<Phase>(
    debate.verdict ? 'verdict' : debate.status === 'void' ? 'void' : 'connecting'
  )
  const [clock, setClock] = useState(0)
  const [rounds, setRounds] = useState<RoundEntry[]>(initialRounds)
  const [verdict, setVerdict] = useState<Verdict | null>(debate.verdict)
  const [pointsMine, setPointsMine] = useState<number | null>(
    debate.verdict
      ? (viewerSeat === 'host' ? debate.points_earned : debate.opponent_points_earned)
      : null
  )
  // tierName is '' for a one-off badge and "Rookie"/"Starter"/... for a family,
  // so a levelled-up family reads as progress rather than as the same badge
  // being handed out again.
  const [myBadges, setMyBadges] = useState<{ slug: string; name: string; tierName?: string }[]>([])
  const [turnIndex, setTurnIndex] = useState(initialSubmitted)
  const [error, setError] = useState('')
  const [moderationNotice, setModerationNotice] = useState<string | null>(null)

  // Call/room state
  const [oppPresent, setOppPresent] = useState(false)
  const [myReady, setMyReady] = useState(false)
  const [oppReady, setOppReady] = useState(false)
  const [camOn, setCamOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [graceLeft, setGraceLeft] = useState<number | null>(null)

  const [slots, setSlots] = useState<Slot[]>(() =>
    TURNS.map((t, i) => ({
      status: i < initialSubmitted ? 'submitted' : t.speaker === viewerSeat ? 'idle' : 'theirs',
    }))
  )

  // Authoritative mutable copies for async pipelines (state mirrors them).
  const slotsRef = useRef<Slot[]>(
    TURNS.map((t, i) => ({
      status: i < initialSubmitted ? 'submitted' : t.speaker === viewerSeat ? 'idle' : 'theirs',
    }))
  )
  const syncSlots = () => setSlots(slotsRef.current.map((s) => ({ ...s })))

  const callRef = useRef<DailyCall | null>(null)
  const phaseRef = useRef<Phase>(phase)
  phaseRef.current = phase
  const turnIndexRef = useRef(initialSubmitted)
  const serverRoundsRef = useRef<RoundEntry[]>(initialRounds)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const pumpingRef = useRef(false)
  const judgeRequestedRef = useRef(false)
  const oppPresentRef = useRef(false)
  const myReadyRef = useRef(false)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const abandonTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isMyTurn = (idx: number) => idx < 6 && TURNS[idx].speaker === viewerSeat

  function send(msg: Msg) {
    try {
      callRef.current?.sendAppMessage(msg, '*')
    } catch {
      // Message loss is tolerated: the DB poll is the safety net.
    }
  }

  // ── Video tiles ───────────────────────────────────────────────────
  const refreshTracks = useCallback(() => {
    const call = callRef.current
    if (!call) return
    const parts = call.participants()
    const local = parts.local
    if (local && localVideoRef.current) {
      const v = local.tracks.video?.persistentTrack
      localVideoRef.current.srcObject = v ? new MediaStream([v]) : null
    }
    const remote = Object.values(parts).find((p) => !p.local)
    if (remoteVideoRef.current) {
      const tracks: MediaStreamTrack[] = []
      const rv = remote?.tracks.video?.persistentTrack
      const ra = remote?.tracks.audio?.persistentTrack
      if (rv) tracks.push(rv)
      if (ra) tracks.push(ra)
      remoteVideoRef.current.srcObject = tracks.length ? new MediaStream(tracks) : null
    }
  }, [])

  // ── Resync: server rounds are ground truth ────────────────────────
  // Used on rejoin (mine or theirs) and as the safety net during their turns.
  // Any of my in-flight, unsubmitted takes are discarded and re-done live —
  // same rule as the same-device arena's refresh behavior.
  const resyncFromServer = useCallback(async (opts?: { discardInFlight?: boolean }) => {
    const supabase = supabaseBrowser()
    const { data: fresh } = await supabase
      .from('debates')
      .select('rounds, status, verdict, points_earned, opponent_points_earned, winner')
      .eq('id', debate.id)
      .maybeSingle()
    if (!fresh) return
    const freshRounds = (fresh.rounds ?? []) as RoundEntry[]
    serverRoundsRef.current = freshRounds
    setRounds(freshRounds)

    if (fresh.verdict) {
      setVerdict(fresh.verdict as Verdict)
      setPointsMine(
        viewerSeat === 'host'
          ? (fresh.points_earned ?? null)
          : ((fresh as { opponent_points_earned?: number | null }).opponent_points_earned ?? null)
      )
      setPhase('verdict')
      return
    }
    if (fresh.status === 'void') {
      setPhase('void')
      return
    }

    const submitted = Math.min(freshRounds.length, 6)
    if (opts?.discardInFlight) {
      for (let i = 0; i < 6; i++) {
        const slot = slotsRef.current[i]
        if (i < submitted) {
          slot.status = 'submitted'
          slot.discarded = false
        } else if (slot.status !== 'idle' && slot.status !== 'theirs') {
          slot.status = TURNS[i].speaker === viewerSeat ? 'idle' : 'theirs'
          slot.discarded = true
          slot.blob = undefined
          slot.text = undefined
        }
      }
      syncSlots()
      turnIndexRef.current = submitted
      setTurnIndex(submitted)
    } else if (submitted > turnIndexRef.current) {
      // Opponent turns landed that we never got messages for: catch up.
      for (let i = 0; i < submitted; i++) {
        if (slotsRef.current[i].status === 'theirs' || slotsRef.current[i].status === 'idle') {
          slotsRef.current[i].status = 'submitted'
        }
      }
      syncSlots()
      turnIndexRef.current = submitted
      setTurnIndex(submitted)
      if (submitted >= 6) {
        setPhase('wrapup')
        void maybeJudge()
      } else {
        setPhase('handoff')
        setClock(breakAfter(submitted - 1))
      }
    }
    void pumpSubmissions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debate.id, viewerSeat])

  // ── Join the room ─────────────────────────────────────────────────
  useEffect(() => {
    if (debate.verdict || debate.status === 'void' || !roomUrl) return
    let cancelled = false
    let call: DailyCall | null = null

    // A match that already has all six turns just needs the judge, not a room.
    if (serverRoundsRef.current.length >= 6) {
      setPhase('wrapup')
      void maybeJudge()
      return
    }

    void (async () => {
      try {
        const res = await fetch('/api/lobby/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ debateId: debate.id }),
        })
        if (!res.ok) throw new Error(`token ${res.status}`)
        const { token } = await res.json()
        if (cancelled) return

        // React StrictMode double-mounts effects in dev, and daily-js forbids
        // duplicate call instances: tear down any straggler first.
        const straggler = DailyIframe.getCallInstance()
        if (straggler) await straggler.destroy()
        if (cancelled) return

        call = DailyIframe.createCallObject()
        callRef.current = call

        call.on('joined-meeting', () => {
          setPhase((p) => (p === 'connecting' ? 'lobby' : p))
          refreshTracks()
          send({ t: 'hello', seat: viewerSeat, ready: myReadyRef.current })
        })
        call.on('participant-joined', () => {
          oppPresentRef.current = true
          setOppPresent(true)
          refreshTracks()
          // They (re)joined: greet with our state so a rejoiner can resync.
          send({ t: 'hello', seat: viewerSeat, ready: myReadyRef.current })
        })
        call.on('participant-left', () => {
          oppPresentRef.current = false
          setOppPresent(false)
          setOppReady(false)
          refreshTracks()
        })
        call.on('participant-updated', refreshTracks)
        call.on('track-started', refreshTracks)
        call.on('track-stopped', refreshTracks)
        call.on('app-message', (ev?: DailyEventObjectAppMessage) => {
          if (ev?.data) handleMessage(ev.data as Msg)
        })

        await call.join({ url: roomUrl, token })
        // Someone may already be in the room before our listeners saw them.
        const parts = call.participants()
        const remoteThere = Object.values(parts).some((p) => !p.local)
        oppPresentRef.current = remoteThere
        setOppPresent(remoteThere)
        refreshTracks()
      } catch (err) {
        console.error('daily join failed', err)
        if (!cancelled) {
          setError('Could not connect to the video room. Refresh to retry.')
        }
      }
    })()

    return () => {
      cancelled = true
      const rec = recorderRef.current
      recorderRef.current = null
      try {
        if (rec && rec.state !== 'inactive') rec.stop()
      } catch {
        // already stopped
      }
      callRef.current = null
      void call?.destroy() // destroy() leaves the meeting first
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Message handling ──────────────────────────────────────────────
  function handleMessage(msg: Msg) {
    switch (msg.t) {
      case 'hello': {
        setOppReady(msg.ready)
        oppPresentRef.current = true
        setOppPresent(true)
        // A hello mid-match means the opponent remounted (reload/rejoin):
        // both sides converge on the server-submitted rounds and re-ready.
        if (
          phaseRef.current !== 'lobby' &&
          phaseRef.current !== 'connecting' &&
          phaseRef.current !== 'wrapup' &&
          phaseRef.current !== 'judging' &&
          phaseRef.current !== 'verdict' &&
          phaseRef.current !== 'void'
        ) {
          stopRecorderDiscard()
          setMyReady(false)
          myReadyRef.current = false
          setOppReady(msg.ready)
          setPhase('lobby')
          void resyncFromServer({ discardInFlight: true })
        }
        break
      }
      case 'ready':
        setOppReady(true)
        break
      case 'turn-start': {
        // Opponent's mic is live: show their speaking clock. Ignore stale
        // indices (we may have advanced past them via the DB safety net).
        if (!isMyTurn(msg.idx) && msg.idx >= turnIndexRef.current) {
          turnIndexRef.current = msg.idx
          setTurnIndex(msg.idx)
          setPhase('speaking')
          setClock(turnSeconds + LISTEN_SLACK_SECONDS)
        }
        break
      }
      case 'turn-done': {
        if (!isMyTurn(msg.idx)) {
          advancePast(msg.idx)
        }
        break
      }
      case 'judged':
      case 'flagged':
        void resyncFromServer()
        break
    }
  }

  function stopRecorderDiscard() {
    const rec = recorderRef.current
    recorderRef.current = null
    try {
      if (rec && rec.state !== 'inactive') {
        rec.ondataavailable = null
        rec.onstop = null
        rec.stop()
      }
    } catch {
      // already stopped
    }
  }

  // ── Ready / tip-off ───────────────────────────────────────────────
  function pressReady() {
    setMyReady(true)
    myReadyRef.current = true
    send({ t: 'ready', seat: viewerSeat })
  }

  // Both ready -> tip-off (topic + sides + coin-flip reveal), then turn 0.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (phase === 'lobby' && myReady && oppReady && oppPresent) {
      setPhase('tipoff')
      setClock(TIPOFF_SECONDS)
    }
  }, [phase, myReady, oppReady, oppPresent])
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Clock ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'tipoff' && phase !== 'countdown' && phase !== 'speaking' && phase !== 'handoff')
      return
    const t = setInterval(() => setClock((c) => c - 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  // Phase transitions at zero. Timer-driven state machine: the next phase must
  // start synchronously (mic on, clock reset), same rationale as the versus
  // arena's waiver.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (clock > 0) return
    if (phase === 'tipoff') beginCountdown()
    else if (phase === 'countdown') {
      if (isMyTurn(turnIndexRef.current)) beginSpeaking()
      else {
        // Their turn: they'll broadcast turn-start any moment. Show the
        // listening clock optimistically.
        setPhase('speaking')
        setClock(turnSeconds + LISTEN_SLACK_SECONDS)
      }
    } else if (phase === 'speaking') {
      if (isMyTurn(turnIndexRef.current)) endTurn()
      // Listener at zero: opponent's turn-done is late. Stay put — the DB
      // poll / abandon flow takes over from here.
    } else if (phase === 'handoff') beginCountdown()
  }, [clock, phase])
  /* eslint-enable react-hooks/exhaustive-deps */

  function beginCountdown() {
    if (turnIndexRef.current >= 6) return
    setPhase('countdown')
    setClock(3)
  }

  function beginSpeaking() {
    if (recorderRef.current) return // double-fire guard
    const call = callRef.current
    const idx = turnIndexRef.current
    if (!call || idx >= 6) return

    // Your turn = your mic is LIVE, no exceptions: the recording feeds the
    // judge. Unmute in Daily (the recorder taps the same track).
    call.setLocalAudio(true)
    setMicOn(true)

    const track = call.participants().local?.tracks?.audio?.persistentTrack
    if (!track) {
      setError('No microphone track. Check mic permissions, then refresh.')
      return
    }
    try {
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(
        new MediaStream([track]),
        mimeType ? { mimeType, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 }
      )
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        void processTurn(idx, blob)
      }
      recorderRef.current = recorder
      recorder.start()
      slotsRef.current[idx].status = 'recording'
      slotsRef.current[idx].discarded = false
      syncSlots()
      setPhase('speaking')
      setClock(turnSeconds)
      send({ t: 'turn-start', idx })
    } catch {
      setError('Could not start the recorder. Refresh to retry.')
    }
  }

  function endTurn() {
    const rec = recorderRef.current
    if (!rec) return // double-fire guard
    recorderRef.current = null
    const finished = turnIndexRef.current
    try {
      if (rec.state !== 'inactive') rec.stop() // onstop kicks off transcription
    } catch {
      // recorder already dead; the slot will surface as failed
    }
    if (slotsRef.current[finished].status === 'recording') {
      slotsRef.current[finished].status = 'transcribing'
      syncSlots()
    }
    send({ t: 'turn-done', idx: finished })
    advancePast(finished)
  }

  function advancePast(finished: number) {
    if (finished < turnIndexRef.current) return // stale
    turnIndexRef.current = finished + 1
    setTurnIndex(finished + 1)
    if (finished >= 5) {
      setPhase('wrapup')
      void maybeJudge()
    } else {
      setPhase('handoff')
      setClock(breakAfter(finished))
    }
  }

  // ── Background pipeline: transcribe my takes, submit in global order ──
  async function processTurn(idx: number, blob: Blob) {
    const slot = slotsRef.current[idx]
    if (slot.discarded) return
    slot.blob = blob
    slot.status = 'transcribing'
    syncSlots()
    try {
      const form = new FormData()
      form.append('audio', blob, 'turn.webm')
      const res = await fetch('/api/debate/transcribe', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`transcribe ${res.status}`)
      const { transcriptId } = await res.json()

      let text: string | null = null
      for (let i = 0; i < 45; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const poll = await fetch(`/api/debate/transcribe?id=${transcriptId}`)
        if (!poll.ok) continue
        const data = await poll.json()
        if (data.status === 'completed') {
          text = typeof data.text === 'string' ? data.text : ''
          break
        }
        if (data.status === 'error') throw new Error('transcription error')
      }
      if (text === null) throw new Error('transcription timeout')
      if (slot.discarded) return

      slot.text = text.trim() || SILENT_TURN_TEXT
      slot.status = 'ready'
      syncSlots()
      void pumpSubmissions()
    } catch {
      if (!slot.discarded) {
        slot.status = 'failed'
        syncSlots()
      }
    }
  }

  // The server appends rounds in strict speaking order, and BOTH clients feed
  // it (each submits their own turns). My slot idx can only go in once the
  // server has exactly idx rounds — i.e. after the opponent's earlier turns
  // have landed from their device.
  async function pumpSubmissions() {
    if (pumpingRef.current) return
    pumpingRef.current = true
    try {
      for (let idx = 0; idx < 6; idx++) {
        const slot = slotsRef.current[idx]
        if (slot.status === 'submitted' || slot.status === 'theirs') continue
        if (slot.status !== 'ready') break
        const serverCount = serverRoundsRef.current.length
        if (serverCount < idx) break // opponent's earlier turn not in yet
        if (serverCount > idx) {
          // Already there (e.g. resubmit after refresh): mark and move on.
          slot.status = 'submitted'
          syncSlots()
          continue
        }
        slot.status = 'submitting'
        syncSlots()
        try {
          const res = await fetch('/api/debate/round', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ debateId: debate.id, text: slot.text }),
          })
          const data = await res.json().catch(() => ({}))
          if (res.status === 409) {
            // Debate finished under us (moderation walkover or a stale turn):
            // trust the server.
            slot.status = 'failed'
            syncSlots()
            void resyncFromServer()
            break
          }
          if (!res.ok) throw new Error(`round ${res.status}`)
          if (data.flagged) {
            // My take was a slur or a 3rd profanity: ranked automatic loss.
            setVerdict(data.verdict as Verdict)
            setPointsMine(viewerSeat === 'host' ? data.pointsHost : data.pointsGuest)
            setRounds(data.rounds as RoundEntry[])
            send({ t: 'flagged' })
            setPhase('verdict')
            slot.status = 'submitted'
            slot.redacted = true
            syncSlots()
            return
          }
          slot.status = 'submitted'
          // Warn / deduct: the turn was redacted but the match continues.
          if (data.moderation) {
            slot.redacted = true
            setModerationNotice(
              moderationNoticeText(
                data.moderation.action as ModerationAction,
                data.moderation.penalty ?? 0
              )
            )
          }
          if (Array.isArray(data.rounds)) {
            serverRoundsRef.current = data.rounds as RoundEntry[]
            setRounds(data.rounds as RoundEntry[])
          }
          syncSlots()
        } catch {
          slot.status = 'failed'
          syncSlots()
          break
        }
      }
    } finally {
      pumpingRef.current = false
    }
    void maybeJudge()
  }

  async function maybeJudge() {
    if (judgeRequestedRef.current) return
    if (serverRoundsRef.current.length < 6) return
    judgeRequestedRef.current = true
    setPhase('judging')
    try {
      const res = await fetch('/api/debate/judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debateId: debate.id }),
      })
      if (!res.ok) throw new Error(`judge ${res.status}`)
      const data = await res.json()
      setVerdict(data.verdict as Verdict)
      // Host is debater A in the judge's transcript, so 'user' means the host
      // won regardless of which seat is reading this. Both devices fire their
      // own event; a ranked match is legitimately two completed debates.
      const v = data.verdict as Verdict | null
      capture(EVENTS.DEBATE_COMPLETED, {
        mode: 'online',
        format: 'speech',
        seat: viewerSeat,
        outcome:
          v?.winner === 'none'
            ? 'draw'
            : (v?.winner === 'user') === (viewerSeat === 'host')
              ? 'win'
              : 'loss',
        score: viewerSeat === 'host' ? v?.user_score : v?.ai_score,
      })
      if (typeof data.pointsHost === 'number' && (data.pointsHost !== 0 || data.pointsGuest !== 0)) {
        setPointsMine(viewerSeat === 'host' ? data.pointsHost : data.pointsGuest)
        const badges = viewerSeat === 'host' ? data.hostBadges : data.guestBadges
        if (Array.isArray(badges)) setMyBadges(badges)
      } else {
        // Lost the judge race: the settled deltas live on the debate row.
        void resyncFromServer()
      }
      send({ t: 'judged' })
      setPhase('verdict')
    } catch {
      judgeRequestedRef.current = false
      setError('The judge stepped out. Hit retry.')
      setPhase('wrapup')
    }
  }

  function retrySlot(idx: number) {
    const slot = slotsRef.current[idx]
    if (slot.status !== 'failed') return
    setError('')
    if (slot.text) {
      slot.status = 'ready'
      syncSlots()
      void pumpSubmissions()
    } else if (slot.blob) {
      void processTurn(idx, slot.blob)
    }
  }

  // ── Safety net: poll server rounds while it's not my turn ─────────
  useEffect(() => {
    if (phase !== 'speaking' && phase !== 'handoff' && phase !== 'wrapup' && phase !== 'countdown')
      return
    const t = setInterval(() => {
      // Only bother when waiting on opponent data.
      if (!isMyTurn(turnIndexRef.current) || phase === 'wrapup') void resyncFromServer()
    }, 10000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Disconnect grace: opponent absent during a live match ─────────
  useEffect(() => {
    // 'wrapup' is deliberately NOT here. It is only ever entered once all six
    // turns are submitted, so by then a disconnect cannot change the result, and
    // polling /abandon through it is how a fully-argued match got recorded as a
    // forfeit. The judge failing drops back to wrapup too, which made that the
    // likeliest way to hit it.
    const active =
      phase === 'lobby' ||
      phase === 'tipoff' ||
      phase === 'countdown' ||
      phase === 'speaking' ||
      phase === 'handoff'
    const matchStarted = phase !== 'lobby' // pregame no-shows are just... leaving
    if (!active || !matchStarted || oppPresent) {
      if (abandonTimerRef.current) {
        clearInterval(abandonTimerRef.current)
        abandonTimerRef.current = null
      }
      // Derived cleanup: the overlay must drop the instant presence recovers.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGraceLeft(null)
      return
    }

    const claim = async () => {
      try {
        const res = await fetch('/api/debate/abandon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ debateId: debate.id }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return
        if (data.status === 'present') {
          setGraceLeft(null)
        } else if (data.status === 'grace') {
          setGraceLeft(data.retryAfter ?? ABANDON_GRACE_SECONDS)
        } else if (data.status === 'void') {
          setPhase('void')
        } else if (data.status === 'forfeit') {
          setVerdict(data.verdict as Verdict)
          setPointsMine(viewerSeat === 'host' ? data.pointsHost : data.pointsGuest)
          setPhase('verdict')
        }
      } catch {
        // Network trouble on our side too; keep retrying.
      }
    }
    void claim()
    abandonTimerRef.current = setInterval(() => void claim(), 10000)
    return () => {
      if (abandonTimerRef.current) {
        clearInterval(abandonTimerRef.current)
        abandonTimerRef.current = null
      }
    }
  }, [oppPresent, phase, debate.id, viewerSeat])

  // ── Terminal phases: hang up ──────────────────────────────────────
  // The debate row never carries the Deep Dive's prose (lib/deep-dive.ts), and
  // this arena often learns the verdict from the row itself (resync, the other
  // seat's judge call). For a player who has it unlocked, ask the judge route,
  // which is idempotent once judged and puts the prose back for them only.
  const needsDeepDive = Boolean(
    deepDiveUnlocked && verdict?.deep_dive?.length && verdict.deep_dive.every((e) => !e.verdict)
  )
  useEffect(() => {
    if (!needsDeepDive) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/debate/judge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ debateId: debate.id }),
        })
        if (!res.ok) return
        const data = await res.json()
        const full = data.verdict as Verdict | null
        if (!cancelled && full?.deep_dive?.some((e) => e.verdict)) {
          setVerdict((v) => (v ? { ...v, deep_dive: full.deep_dive } : v))
        }
      } catch {
        // The locked teaser still shows; nothing to retry against.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [needsDeepDive, debate.id])

  // The verdict/void screens must not leave the camera and mic silently live
  // to the opponent: tear the call down the moment the match is over.
  useEffect(() => {
    if (phase !== 'verdict' && phase !== 'void') return
    const call = callRef.current
    callRef.current = null
    void call?.destroy()
  }, [phase])

  // ── Controls ──────────────────────────────────────────────────────
  const myTurnLive = phase === 'speaking' && isMyTurn(Math.min(turnIndex, 5))
  function toggleCam() {
    const next = !camOn
    callRef.current?.setLocalVideo(next)
    setCamOn(next)
  }
  function toggleMic() {
    if (myTurnLive) return // your speaking turn records; mic stays live
    const next = !micOn
    callRef.current?.setLocalAudio(next)
    setMicOn(next)
  }

  // ── Derived ───────────────────────────────────────────────────────
  const idx = Math.min(turnIndex, 5)
  const current = TURNS[idx]
  const roundNumber = ROUND_ORDER.indexOf(current.round) + 1
  const failedCount = slots.filter((s) => s.status === 'failed').length
  const liveClockDanger = phase === 'speaking' && clock <= 10 && myTurnLive
  const inMatch =
    phase === 'tipoff' || phase === 'countdown' || phase === 'speaking' || phase === 'handoff'
  const showCall = phase !== 'verdict' && phase !== 'void' && phase !== 'connecting'
  const won =
    verdict &&
    ((viewerSeat === 'host' && verdict.winner === 'user') ||
      (viewerSeat === 'guest' && verdict.winner === 'opponent'))

  const slotLabel = (s: Slot, i: number): string => {
    if (s.status === 'theirs')
      return i < turnIndex ? 'ON THEIR DEVICE…' : 'WAITING'
    switch (s.status) {
      case 'submitted':
        return s.redacted ? 'SAVED · BLEEPED' : 'SAVED'
      case 'recording':
        return 'ON THE MIC'
      case 'transcribing':
        return 'IN THE BOOTH…'
      case 'ready':
      case 'submitting':
        return 'SAVING…'
      case 'failed':
        return 'FAILED'
      default:
        return 'WAITING'
    }
  }

  const revealTopic = phase !== 'connecting' && phase !== 'lobby'

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="relative min-h-dvh bg-ink text-chalk">
      <div className="grain" aria-hidden />

      <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur-sm">
        <div
          className={`mx-auto flex h-14 items-center justify-between gap-3 px-5 ${
            phase === 'verdict' ? 'max-w-6xl' : 'max-w-5xl'
          }`}
        >
          <a
            href="/dashboard"
            aria-label="Heated, locker room"
            className="flex shrink-0 items-center gap-1.5"
          >
            <Image src="/logo-mark.png" alt="" width={64} height={64} className="h-8 w-8 -translate-y-0.5 sm:h-10 sm:w-10" />
            <Image src="/wordmark-red.png" alt="" width={253} height={36} className="h-4 w-auto max-[359px]:hidden sm:h-5" />
          </a>
          {phase === 'verdict' ? (
            <a
              href="/dashboard"
              className="inline-flex min-h-[44px] items-center px-1 text-sm font-semibold text-chalk-2 transition-colors hover:text-chalk"
            >
              Locker room
            </a>
          ) : (
            <span className="min-w-0 truncate text-right font-mono text-[10px] tracking-[0.25em] text-chalk-3">
              RANKED · {hostName.toUpperCase()} VS {guestName.toUpperCase()}
            </span>
          )}
        </div>
      </header>

      <main
        className={`mx-auto px-5 ${phase === 'verdict' ? 'max-w-6xl py-8 pb-16' : 'max-w-5xl py-8'}`}
      >
        {/* Topic strip: sealed until tip-off for random matchups. The verdict
            carries its own. */}
        {phase !== 'verdict' && (
          <>
        <p className="font-mono text-xs tracking-[0.3em] text-blaze-bright">THE TOPIC</p>
        <h1
          className={`mt-2 font-athletic font-black uppercase tracking-tight leading-[0.95] ${
            phase === 'tipoff'
              ? 'text-[clamp(1.75rem,5vw,3rem)]'
              : 'text-xl sm:text-2xl'
          }`}
        >
          {revealTopic ? debate.topic_text : 'Sealed until tip-off.'}
        </h1>
        {revealTopic && (
          <p className="mt-2 font-mono text-[11px] tracking-[0.2em] text-chalk-3">
            {hostName.toUpperCase()}: {hostSide.toUpperCase()} · {guestName.toUpperCase()}:{' '}
            {guestSide.toUpperCase()}
          </p>
        )}
        <span className="mt-3 inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] text-blaze-bright">
          LIVE VIDEO · RANKED · WINNER TAKES THE POINTS
        </span>
          </>
        )}

        {moderationNotice && phase !== 'verdict' && (
          <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            {moderationNotice}
          </p>
        )}

        {/* ── The call: two tiles + controls ── */}
        {showCall && (
          <div className="mt-8 grid gap-3 sm:grid-cols-[1fr_minmax(8rem,0.4fr)]">
            <div className="relative overflow-hidden rounded-card border border-line bg-panel">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="aspect-video w-full object-cover"
              />
              {!oppPresent && (
                <div className="absolute inset-0 flex items-center justify-center bg-panel">
                  <p className="font-mono text-[10px] tracking-[0.3em] text-chalk-3 animate-pulse">
                    WAITING FOR {nameOf(otherSeat).toUpperCase()}…
                  </p>
                </div>
              )}
              <span className="absolute bottom-2 left-3 font-mono text-[10px] tracking-[0.2em] text-chalk-2">
                {nameOf(otherSeat).toUpperCase()}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              <div className="relative flex-1 overflow-hidden rounded-card border border-line bg-panel">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full scale-x-[-1] object-cover"
                />
                <span className="absolute bottom-2 left-3 font-mono text-[10px] tracking-[0.2em] text-chalk-2">
                  YOU
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={toggleCam}
                  className={`press flex-1 inline-flex min-h-[44px] items-center justify-center rounded-card border px-3 py-2 font-mono text-[10px] tracking-widest ${
                    camOn ? 'border-line text-chalk-2' : 'border-red-500/50 text-red-400'
                  }`}
                >
                  {camOn ? 'CAM ON' : 'CAM OFF'}
                </button>
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={myTurnLive}
                  title={myTurnLive ? 'Your mic stays live on your turn' : undefined}
                  className={`press flex-1 inline-flex min-h-[44px] items-center justify-center rounded-card border px-3 py-2 font-mono text-[10px] tracking-widest disabled:opacity-60 ${
                    micOn ? 'border-line text-chalk-2' : 'border-red-500/50 text-red-400'
                  }`}
                >
                  {micOn ? 'MIC ON' : 'MUTED'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Connecting ── */}
        {phase === 'connecting' && !error && (
          <div className="bezel bezel-primary mt-8 p-8 text-center">
            <p className="font-mono text-[11px] tracking-[0.3em] text-chalk-3 animate-pulse">
              CONNECTING TO THE ARENA…
            </p>
          </div>
        )}

        {/* ── Lobby / ready check ── */}
        {phase === 'lobby' && (
          <div className="bezel bezel-primary mt-8 p-6 text-center md:p-10">
            <p className="font-mono text-xs tracking-[0.3em] text-blaze-bright">THE FORMAT</p>
            <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-chalk-3">
              Contention, rebuttal, summary. {fmtClock(turnSeconds)} a turn, both of
              you every round, {HANDOFF_BREAK_SECONDS}s hand-offs, {SECTION_BREAK_SECONDS}s
              between sections. A coin flip decides who leads. Your mic goes live
              automatically on your turns. Winner takes the points.
            </p>
            <div className="mx-auto mt-6 flex max-w-sm items-center justify-center gap-6 font-mono text-[11px] tracking-[0.2em]">
              <span className={myReady ? 'text-blaze-bright' : 'text-chalk-3'}>
                YOU {myReady ? 'READY' : 'NOT READY'}
              </span>
              <span className={oppReady ? 'text-blaze-bright' : 'text-chalk-3'}>
                {nameOf(otherSeat).toUpperCase()}{' '}
                    {oppReady ? 'READY' : oppPresent ? 'NOT READY' : 'NOT HERE'}
              </span>
            </div>
            {!myReady && (
              <Button type="button" size="lg" onClick={pressReady} className="mt-8">
                <Circle size={14} weight="fill" aria-hidden />
                  I&apos;M READY
              </Button>
            )}
            {myReady && !oppReady && (
              <p className="mt-8 font-mono text-[10px] tracking-[0.3em] text-chalk-3 animate-pulse">
                WAITING ON {nameOf(otherSeat).toUpperCase()}…
              </p>
            )}
          </div>
        )}

        {/* ── Tip-off reveal ── */}
        {phase === 'tipoff' && (
          <div key="tipoff" className="bezel bezel-primary pop-in mt-8 px-6 py-10 text-center">
            <p className="font-mono text-[11px] tracking-[0.3em] text-blaze-bright">TIP-OFF</p>
            <p className="mt-5 font-athletic font-black uppercase tracking-tight leading-none text-[clamp(1.75rem,6vw,3rem)]">
              You argue: {sideOf(viewerSeat)}
            </p>
            <p className="mt-4 text-sm text-chalk-3">
              Coin flip says <span className="font-semibold text-blaze-bright">{nameOf(first)}</span>{' '}
              leads every round. First up in {Math.max(1, clock)}…
            </p>
          </div>
        )}

        {/* ── Live stage ── */}
        {(phase === 'countdown' || phase === 'speaking' || phase === 'handoff') && (
          <div key={phase} className="bezel bezel-primary pop-in mt-8 px-6 py-8 text-center md:py-10">
            <p className="font-mono text-[11px] tracking-[0.3em] text-chalk-3">
              ROUND {roundNumber} OF 3 · {ROUND_COPY[current.round].title}
            </p>

            {phase === 'countdown' && (
              <>
                <p className="mt-5 font-athletic font-black uppercase tracking-tight leading-none text-[clamp(1.75rem,6vw,3rem)]">
                  {isMyTurn(idx) ? "YOU'RE UP" : `${nameOf(current.speaker).toUpperCase()} IS UP`}
                </p>
                <p className="mt-2 text-sm text-chalk-3">
                  Arguing: <span className="text-chalk-2">{sideOf(current.speaker)}</span>
                </p>
                <div className="relative mx-auto mt-6 flex h-[clamp(5.5rem,20vw,8rem)] w-[clamp(5.5rem,20vw,8rem)] items-center justify-center">
                  <TurnRing remaining={clock} total={3} />
                  <p className="font-athletic font-black leading-none tabular-nums text-[clamp(2.5rem,10vw,4rem)] text-blaze-bright">
                    {Math.max(1, clock)}
                  </p>
                </div>
                {isMyTurn(idx) && (
                  <p className="mt-3 font-mono text-[10px] tracking-[0.3em] text-chalk-3 animate-pulse">
                    YOUR MIC GOES LIVE AT ZERO
                  </p>
                )}
              </>
            )}

            {phase === 'speaking' && (
              <>
                <p className="mt-4 font-athletic font-black uppercase tracking-tight leading-none text-[clamp(1.75rem,6vw,3rem)]">
                  {isMyTurn(idx) ? 'TALK YOUR TALK' : `${nameOf(current.speaker).toUpperCase()} HAS THE FLOOR`}
                </p>
                <p className="mt-2 text-sm text-chalk-3">
                  {isMyTurn(idx)
                    ? ROUND_COPY[current.round].hint
                    : 'Listen up. The rebuttal writes itself if you pay attention.'}
                </p>
                <div className="relative mx-auto mt-6 flex h-[clamp(7rem,26vw,10rem)] w-[clamp(7rem,26vw,10rem)] items-center justify-center">
                  <TurnRing
                    remaining={Math.min(clock, turnSeconds)}
                    total={turnSeconds}
                    danger={liveClockDanger}
                  />
                  <p
                    className={`font-athletic font-black leading-none tabular-nums text-[clamp(2.25rem,9vw,3.75rem)] ${
                      liveClockDanger ? 'text-red-400' : 'text-chalk'
                    }`}
                  >
                    {fmtClock(Math.min(clock, turnSeconds))}
                  </p>
                </div>
                {isMyTurn(idx) ? (
                  <>
                    <p className="mt-3 inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-red-400">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
                      RECORDING · MIC LIVE
                    </p>
                    <div className="mt-6">
                      <Button type="button" onClick={endTurn}>
                        <Square size={14} weight="fill" aria-hidden />
                  DONE, NEXT
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="mt-3 font-mono text-[10px] tracking-[0.3em] text-chalk-3">
                    THEIR CLOCK · YOUR TURN COMES NEXT
                  </p>
                )}
              </>
            )}

            {phase === 'handoff' && (
              <>
                <p className="mt-5 font-athletic font-black uppercase tracking-tight leading-none text-[clamp(1.75rem,6vw,3rem)]">
                  {isMyTurn(idx) ? 'YOU GET THE MIC NEXT' : `${nameOf(current.speaker).toUpperCase()} IS UP NEXT`}
                </p>
                <p className="mt-2 text-sm text-chalk-3">
                  {ROUND_COPY[current.round].title.toLowerCase()} · arguing{' '}
                  <span className="text-chalk-2">{sideOf(current.speaker)}</span>
                </p>
                <p className="mt-6 font-athletic font-black leading-none tabular-nums text-[clamp(3rem,14vw,6rem)] text-chalk-2">
                  {fmtClock(clock)}
                </p>
              </>
            )}
          </div>
        )}

        {/* ── Wrap-up / judging ── */}
        {(phase === 'wrapup' || phase === 'judging') && (
          <div className="bezel bezel-primary mt-8 p-6 md:p-8">
            <p className="font-mono text-xs tracking-[0.3em] text-blaze-bright">
              {phase === 'judging' ? 'THE JUDGE IS DELIBERATING…' : "THAT'S THE BALLGAME"}
            </p>
            <p className="mt-3 text-sm text-chalk-3">
              {phase === 'judging'
                ? 'All six takes are in. Scores incoming.'
                : 'Locking in the takes from both devices before the judge rules.'}
            </p>
            <ul className="mt-6 space-y-2">
              {TURNS.map((t, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 border-b border-line pb-2 font-mono text-[11px] tracking-[0.2em]"
                >
                  <span className="text-chalk-2">
                    {ROUND_COPY[t.round].title} · {nameOf(t.speaker).toUpperCase()}
                  </span>
                  <span
                    className={
                      slots[i].status === 'submitted'
                        ? 'text-blaze-bright'
                        : slots[i].status === 'failed'
                          ? 'text-red-400'
                          : 'text-chalk-3 animate-pulse'
                    }
                  >
                    {slotLabel(slots[i], i)}
                    {slots[i].status === 'failed' && slots[i].blob && (
                      <button
                        type="button"
                        onClick={() => retrySlot(i)}
                        className="-my-2 ml-3 inline-block px-2 py-3 font-semibold text-blaze-bright hover:underline"
                      >
                        RETRY
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {failedCount === 0 && phase === 'wrapup' && (
              <p className="mt-4 font-mono text-[10px] tracking-[0.3em] text-chalk-3 animate-pulse">
                HANG TIGHT…
              </p>
            )}
          </div>
        )}

        {/* ── Void ── */}
        {phase === 'void' && (
          <div className="bezel mt-8 p-8 text-center md:p-10">
            <p className="font-mono text-xs tracking-[0.3em] text-chalk-3">MATCH VOIDED</p>
            <p className="mt-4 font-athletic text-3xl font-black uppercase tracking-tight">
              Nobody wins this one.
            </p>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-chalk-3">
              The match ended before the rebuttal, so it&apos;s a wash: no points
              moved, and both players get their ticket back.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/dashboard/live" className={buttonClasses('primary', 'md')}>
                BACK TO THE LIVE BOARD
              </Link>
              <Link href="/dashboard" className={buttonClasses('secondary', 'md')}>
                LOCKER ROOM
              </Link>
            </div>
          </div>
        )}

        {/* ── Verdict ── from the viewer's seat, leading the page. */}
        {phase === 'verdict' && verdict && (
          <VerdictPanel
            eyebrow="THE VERDICT · RANKED"
            headline={verdict.winner === 'none' ? 'Draw.' : won ? 'You won.' : 'You lost.'}
            topic={debate.topic_text}
            summary={`${viewerSeat === 'host' ? verdict.user_score : verdict.ai_score} to ${
              viewerSeat === 'host' ? verdict.ai_score : verdict.user_score
            } against ${nameOf(otherSeat)}. You argued ${sideOf(viewerSeat)}.`}
            outcome={verdict.winner === 'none' ? 'draw' : won ? 'won' : 'lost'}
            left={{
              name: 'You',
              side: sideOf(viewerSeat),
              score: viewerSeat === 'host' ? verdict.user_score : verdict.ai_score,
              win: Boolean(won),
              rubric: viewerSeat === 'host' ? verdict.breakdown?.user : verdict.breakdown?.ai,
            }}
            right={{
              name: nameOf(otherSeat),
              side: sideOf(otherSeat),
              score: viewerSeat === 'host' ? verdict.ai_score : verdict.user_score,
              win: verdict.winner !== 'none' && !won,
              rubric: viewerSeat === 'host' ? verdict.breakdown?.ai : verdict.breakdown?.user,
            }}
            note={verdict.note}
            receipts={verdict.receipts}
            deepDive={verdict.deep_dive}
            deepDiveUnlocked={deepDiveUnlocked}
            isFounding={isFounding}
            surface="verdict_online"
            points={
              pointsMine !== null ? (
                <div className="flex items-center justify-between gap-4 border-y border-line py-4">
                  <span className="text-sm text-chalk-3">
                    {pointsMine > 0 ? 'Ranked win' : pointsMine < 0 ? 'Ranked loss' : 'No points move on a draw'}
                  </span>
                  <span
                    className={`font-athletic text-3xl font-black leading-none tabular-nums ${
                      pointsMine > 0 ? 'text-blaze-bright' : 'text-chalk-2'
                    }`}
                  >
                    {pointsMine > 0 ? `+${pointsMine}` : pointsMine}
                    <span className="sr-only"> points</span>
                  </span>
                </div>
              ) : (
                <p className="border-y border-line py-4 text-sm text-chalk-3">
                  Points are settled. Your Locker room has the new total.
                </p>
              )
            }
            badges={
              myBadges.length > 0 ? (
                <div className="bezel p-5">
                  <p className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-blaze-bright">
                    NEW BADGE{myBadges.length > 1 ? 'S' : ''}
                  </p>
                  <p className="mt-2 text-sm text-chalk">
                    {myBadges.map((b) => (b.tierName ? `${b.name} (${b.tierName})` : b.name)).join(' · ')}
                  </p>
                </div>
              ) : undefined
            }
            actions={
              // Scored from the viewer's seat, not the debate owner's: the guest
              // sharing "I beat them" after losing would be worse than no share
              // button at all. Only the host (debate.user_id) can change what is
              // published or take it down.
              <VerdictNextStep
                share={{
                  debateId: debate.id,
                  score: viewerSeat === 'host' ? verdict.user_score : verdict.ai_score,
                  opponentScore: viewerSeat === 'host' ? verdict.ai_score : verdict.user_score,
                  opponentName: nameOf(otherSeat),
                  outcome: verdict.winner === 'none' ? 'tied' : won ? 'won' : 'lost',
                  canManage: viewerSeat === 'host',
                  initialReceipts: debate.share_receipts !== false,
                  initialName: debate.share_name !== false,
                  initialRevoked: debate.share_revoked === true,
                }}
                rerunHref="/dashboard/live"
                isFounding={isFounding}
                surface="verdict_online"
              />
            }
            rounds={rounds}
            nameOf={(s) => (s === viewerSeat ? 'You' : nameOf(s as HumanSpeaker))}
            isLeft={(s) => s === viewerSeat}
            justLanded={!debate.verdict}
          />
        )}

        {/* ── Disconnect overlay ── */}
        {graceLeft !== null && (inMatch || phase === 'wrapup') && (
          <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-ink/95 px-6 text-center">
            <p className="font-athletic font-black uppercase leading-none text-[clamp(2rem,8vw,4rem)]">
              {nameOf(otherSeat)} dropped
            </p>
            <p className="max-w-md text-sm leading-relaxed text-chalk-3">
              Giving them {graceLeft}s to reconnect. If they don&apos;t make it
              back: before the rebuttal the match is voided (slot refunded),
              after it you take the win by forfeit.
            </p>
            <p className="font-mono text-[11px] tracking-[0.3em] text-chalk-3 animate-pulse">
              HOLD THE LINE…
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-6 text-sm text-red-400">
            {error}
            {phase === 'wrapup' && failedCount === 0 && (
              <button
                type="button"
                onClick={() => void maybeJudge()}
                className="-my-2 ml-3 inline-block px-2 py-3 font-semibold text-blaze-bright hover:underline"
              >
                Retry
              </button>
            )}
          </p>
        )}
      </main>
    </div>
  )
}
