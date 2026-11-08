'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { TurnRing } from '@/components/turn-ring'
import VerdictPanel, { VerdictNextStep } from '@/components/verdict-panel'
import { Square } from '@phosphor-icons/react/dist/ssr'
import {
  ROUND_ORDER,
  ROUND_COPY,
  HANDOFF_BREAK_SECONDS,
  SECTION_BREAK_SECONDS,
  SILENT_TURN_TEXT,
  type RoundEntry,
  type RoundName,
  type Verdict,
  type HumanSpeaker,
  type VersusConfig,
} from '@/lib/debate'
import { EVENTS, capture } from '@/lib/analytics'

type Debate = {
  id: string
  topic_text: string
  user_side: string | null
  status: string
  rounds: RoundEntry[] | null
  verdict: Verdict | null
  versus: Partial<VersusConfig> | null
  share_revoked: boolean | null
  share_receipts: boolean | null
  share_name: boolean | null
}

// The live same-device Human vs Human stage. One phone between two people:
// six speaking turns (both speakers per section), auto-started with a 3-2-1
// count, hand-off breaks between turns, pausable anywhere. Audio is recorded
// per turn and transcribed in the background while the debate keeps moving;
// rounds are submitted to the server strictly in speaking order (the server
// derives whose turn it is), then the AI judge rules. Exhibition: no points.

type Phase = 'pregame' | 'countdown' | 'speaking' | 'handoff' | 'wrapup' | 'judging' | 'verdict'

type SlotStatus =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'ready'
  | 'submitting'
  | 'submitted'
  | 'failed'

type Slot = {
  status: SlotStatus
  text?: string
  blob?: Blob
  redacted?: boolean
}

// Same fallback chain as the vs-AI arena: Safari can't do webm.
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return undefined
}

const fmtClock = (s: number) =>
  `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`

export default function VersusArena({
  debate,
  hostName,
  deepDiveUnlocked,
  isFounding = false,
}: {
  debate: Debate
  hostName: string
  deepDiveUnlocked: boolean
  isFounding?: boolean
}) {
  const versus = debate.versus ?? {}
  const guestName = versus.guest_name?.trim() || 'The Challenger'
  const guestSide = versus.guest_side?.trim() || 'the other side'
  const hostSide = debate.user_side?.trim() || 'their side'
  const turnSeconds =
    typeof versus.turn_seconds === 'number' && [60, 90, 120].includes(versus.turn_seconds)
      ? versus.turn_seconds
      : 120
  const first: HumanSpeaker = versus.first === 'guest' ? 'guest' : 'host'
  const second: HumanSpeaker = first === 'host' ? 'guest' : 'host'

  // Six turns in speaking order: the coin-flip winner leads every section.
  const TURNS: { round: RoundName; speaker: HumanSpeaker }[] = ROUND_ORDER.flatMap((round) => [
    { round, speaker: first },
    { round, speaker: second },
  ])

  const nameOf = (s: HumanSpeaker) => (s === 'host' ? hostName : guestName)
  const sideOf = (s: HumanSpeaker) => (s === 'host' ? hostSide : guestSide)
  // Break after finishing turn i: short hand-off inside a section, longer
  // between sections.
  const breakAfter = (i: number) =>
    TURNS[i].round === TURNS[i + 1]?.round ? HANDOFF_BREAK_SECONDS : SECTION_BREAK_SECONDS

  // ── State ─────────────────────────────────────────────────────────
  const initialRounds = (debate.rounds ?? []) as RoundEntry[]
  const initialSubmitted = Math.min(initialRounds.length, 6)

  const [rounds, setRounds] = useState<RoundEntry[]>(initialRounds)
  const [verdict, setVerdict] = useState<Verdict | null>(debate.verdict)
  const [phase, setPhase] = useState<Phase>(debate.verdict ? 'verdict' : 'pregame')
  const [clock, setClock] = useState(0)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState('')
  const [redactionNotice, setRedactionNotice] = useState(false)
  // Render-facing mirror of turnIndexRef (refs must not be read during render).
  const [turnIndex, setTurnIndex] = useState(initialSubmitted)
  const [slots, setSlots] = useState<Slot[]>(() =>
    TURNS.map((_, i) => ({ status: i < initialSubmitted ? 'submitted' : 'idle' }))
  )

  // Authoritative mutable copies for async pipelines; `slots` mirrors them.
  const slotsRef = useRef<Slot[]>(
    TURNS.map((_, i) => ({ status: i < initialSubmitted ? 'submitted' : 'idle' }))
  )
  const syncSlots = () => setSlots(slotsRef.current.map((s) => ({ ...s })))

  const turnIndexRef = useRef(initialSubmitted) // next turn to speak
  const submitCursorRef = useRef(initialSubmitted) // next slot to submit, in order
  const pumpingRef = useRef(false)
  const judgeRequestedRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)

  function releaseStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  useEffect(() => {
    return () => {
      const rec = recorderRef.current
      recorderRef.current = null
      try {
        if (rec && rec.state !== 'inactive') rec.stop()
      } catch {
        // already stopped
      }
      releaseStream()
    }
  }, [])

  // ── The clock: one ticking interval for countdown / speaking / handoff ──
  useEffect(() => {
    if (paused) return
    if (phase !== 'countdown' && phase !== 'speaking' && phase !== 'handoff') return
    const t = setInterval(() => setClock((c) => c - 1), 1000)
    return () => clearInterval(t)
  }, [phase, paused])

  // ── Flow ──────────────────────────────────────────────────────────
  async function tipOff() {
    setError('')
    // Everything already recorded (e.g. refresh after the last turn): go
    // straight to processing + the verdict.
    if (turnIndexRef.current >= 6) {
      setPhase('wrapup')
      void maybeJudge()
      return
    }
    if (typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record audio. Try Chrome or Safari.')
      return
    }
    try {
      // One stream for the whole debate, grabbed on a user gesture so turns
      // can auto-start later without re-prompting for the mic.
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Microphone access denied. Allow the mic to run a live debate.')
      return
    }
    beginCountdown()
  }

  function beginCountdown() {
    setPhase('countdown')
    setClock(3)
  }

  function beginSpeaking() {
    if (recorderRef.current) return // already live (double-fire guard)
    const stream = streamRef.current
    const idx = turnIndexRef.current
    if (!stream || idx >= 6) return
    try {
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(
        stream,
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
      syncSlots()
      setPhase('speaking')
      setClock(turnSeconds)
    } catch {
      setError('Could not start the recorder. Tap resume to retry.')
    }
  }

  function endTurn() {
    const rec = recorderRef.current
    if (!rec) return // double-fire guard
    recorderRef.current = null
    try {
      if (rec.state !== 'inactive') rec.stop() // onstop kicks off transcription
    } catch {
      // recorder already dead; the slot will surface as failed
    }
    const finished = turnIndexRef.current
    if (slotsRef.current[finished].status === 'recording') {
      slotsRef.current[finished].status = 'transcribing'
      syncSlots()
    }
    turnIndexRef.current = finished + 1
    setTurnIndex(finished + 1)
    if (finished >= 5) {
      releaseStream() // debate's over, give the mic back
      setPhase('wrapup')
      void maybeJudge()
    } else {
      setPhase('handoff')
      setClock(breakAfter(finished))
    }
  }

  function togglePause() {
    const rec = recorderRef.current
    if (paused) {
      try {
        if (rec?.state === 'paused') rec.resume()
      } catch {
        // resume best-effort
      }
      setPaused(false)
    } else {
      try {
        if (rec?.state === 'recording') rec.pause()
      } catch {
        // pause best-effort
      }
      setPaused(true)
    }
  }

  // Phase transitions when the clock runs out. This is a timer-driven state
  // machine: at zero the next phase MUST start synchronously (mic on, clock
  // reset), so the set-state-in-effect rule is intentionally waived here.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (paused || clock > 0) return
    if (phase === 'countdown') beginSpeaking()
    else if (phase === 'speaking') endTurn()
    else if (phase === 'handoff') beginCountdown()
  }, [clock, phase, paused])
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // ── Background pipeline: transcribe each take, submit in order ────
  async function processTurn(idx: number, blob: Blob) {
    const slot = slotsRef.current[idx]
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

      slot.text = text.trim() || SILENT_TURN_TEXT
      slot.status = 'ready'
      syncSlots()
      void pumpSubmissions()
    } catch {
      slot.status = 'failed'
      syncSlots()
    }
  }

  // Rounds must reach the server in speaking order (it derives the speaker
  // from the stored rounds), so a single cursor walks the slots and submits
  // each one as soon as it and everything before it is ready.
  async function pumpSubmissions() {
    if (pumpingRef.current) return
    pumpingRef.current = true
    try {
      while (submitCursorRef.current < 6) {
        const idx = submitCursorRef.current
        const slot = slotsRef.current[idx]
        if (slot.status !== 'ready') break
        slot.status = 'submitting'
        syncSlots()
        try {
          const res = await fetch('/api/debate/round', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ debateId: debate.id, text: slot.text }),
          })
          if (!res.ok) throw new Error(`round ${res.status}`)
          const data = await res.json()
          slot.status = 'submitted'
          slot.redacted = Boolean(data.redacted)
          if (data.redacted) setRedactionNotice(true)
          if (Array.isArray(data.rounds)) setRounds(data.rounds as RoundEntry[])
          submitCursorRef.current = idx + 1
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
    if (turnIndexRef.current < 6 || submitCursorRef.current < 6) return
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
      setVerdict(data.verdict)
      // Same-device is an exhibition: no points, no seat to attribute a win to,
      // so this carries completion only. It is still the mode two personas
      // rated most believable, so it needs to be visible in the funnel.
      capture(EVENTS.DEBATE_COMPLETED, {
        mode: 'same_device',
        format: 'speech',
      })
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
      // Transcription worked, saving failed: just resubmit.
      slot.status = 'ready'
      syncSlots()
      void pumpSubmissions()
    } else if (slot.blob) {
      void processTurn(idx, slot.blob)
    }
  }

  // ── Derived UI bits ───────────────────────────────────────────────
  const idx = Math.min(turnIndex, 5)
  const current = TURNS[idx]
  const roundNumber = ROUND_ORDER.indexOf(current.round) + 1
  const processingCount = slots.filter(
    (s) => s.status === 'transcribing' || s.status === 'ready' || s.status === 'submitting'
  ).length
  const failedCount = slots.filter((s) => s.status === 'failed').length
  const liveClockDanger = phase === 'speaking' && clock <= 10

  const slotLabel = (s: Slot): string => {
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

  const speakerChip = (s: HumanSpeaker, big = false) => (
    <span className={big ? 'text-blaze-bright' : ''}>{nameOf(s).toUpperCase()}</span>
  )

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="relative min-h-dvh bg-ink text-chalk">
      <div className="grain" aria-hidden />

      <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur-sm">
        <div
          className={`mx-auto flex h-14 items-center justify-between gap-3 px-5 ${
            phase === 'verdict' ? 'max-w-6xl' : 'max-w-4xl'
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
              LIVE · {hostName.toUpperCase()} VS {guestName.toUpperCase()}
            </span>
          )}
        </div>
      </header>

      <main
        className={`mx-auto px-5 ${phase === 'verdict' ? 'max-w-6xl py-8 pb-16' : 'max-w-4xl py-10'}`}
      >
        {/* Topic strip (small during live phases). The verdict carries its own. */}
        {phase !== 'verdict' && (
          <>
        <p className="font-mono text-xs tracking-[0.3em] text-blaze-bright">THE TOPIC</p>
        <h1
          className={`mt-2 font-athletic font-black uppercase tracking-tight leading-[0.95] ${
            phase === 'pregame'
              ? 'text-[clamp(1.75rem,5vw,3rem)]'
              : 'text-xl sm:text-2xl'
          }`}
        >
          {debate.topic_text}
        </h1>
        <p className="mt-2 font-mono text-[11px] tracking-[0.2em] text-chalk-3">
          {hostName.toUpperCase()}: {hostSide.toUpperCase()} · {guestName.toUpperCase()}:{' '}
          {guestSide.toUpperCase()}
        </p>
        <span className="mt-3 inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] text-blaze-bright">
          EXHIBITION · FULL VERDICT · ZERO POINTS
        </span>
          </>
        )}

        {redactionNotice && phase !== 'verdict' && (
          <p className="mt-4 inline-block rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 font-mono text-[10px] tracking-[0.2em] text-amber-300">
            A TAKE GOT BLEEPED · PLAY CONTINUES
          </p>
        )}

        {/* ── Pregame ── */}
        {phase === 'pregame' && (
          <div className="bezel bezel-primary mt-10 p-6 md:p-10">
            <p className="font-mono text-xs tracking-[0.3em] text-blaze-bright">
              {initialSubmitted > 0 && initialSubmitted < 6 ? 'RESUME THE DEBATE' : 'THE FORMAT'}
            </p>
            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div>
                <p className="font-mono text-[10px] tracking-[0.3em] text-chalk-3">SPEAKERS</p>
                <p className="mt-2 text-lg font-semibold">
                  {hostName} <span className="text-chalk-3">vs</span> {guestName}
                </p>
                <p className="mt-1 text-sm text-chalk-3">
                  Coin flip says <span className="text-blaze-bright font-semibold">{nameOf(first)}</span>{' '}
                  leads every round.
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] tracking-[0.3em] text-chalk-3">THE CLOCK</p>
                <p className="mt-2 text-sm leading-relaxed text-chalk-3">
                  Contention, rebuttal, summary. {fmtClock(turnSeconds)} a turn,{' '}
                  {HANDOFF_BREAK_SECONDS}s hand-offs, {SECTION_BREAK_SECONDS}s between sections.
                  Turns start on their own with a 3-2-1. Pause anytime, end a turn early anytime.
                </p>
              </div>
            </div>
            {initialSubmitted > 0 && initialSubmitted < 6 && (
              <p className="mt-5 border-t border-line pt-5 text-sm text-chalk-3">
                {initialSubmitted} of 6 turns are already in the books. Next up:{' '}
                <span className="text-blaze-bright font-semibold">{nameOf(TURNS[initialSubmitted].speaker)}</span>{' '}
                on the {ROUND_COPY[TURNS[initialSubmitted].round].title.toLowerCase()}.
              </p>
            )}
            <Button
              type="button"
              size="lg"
              onClick={() => void tipOff()}
              className="mt-8 w-full sm:w-auto"
            >
              {turnIndex >= 6
                ? 'GET THE VERDICT'
                : initialSubmitted > 0
                  ? 'RESUME'
                  : 'TIP-OFF'}
            </Button>
            <p className="mt-3 font-mono text-[10px] tracking-[0.2em] text-chalk-3">
              ONE PHONE, MIC OPEN THE WHOLE TURN. PARK IT BETWEEN YOU OR PASS IT.
            </p>
          </div>
        )}

        {/* ── Live stage (countdown / speaking / handoff) ── */}
        {(phase === 'countdown' || phase === 'speaking' || phase === 'handoff') && (
          <div className="relative mt-10">
            <div key={phase} className="bezel bezel-primary pop-in px-6 py-10 text-center md:py-14">
              <p className="font-mono text-[11px] tracking-[0.3em] text-chalk-3">
                ROUND {roundNumber} OF 3 · {ROUND_COPY[current.round].title}
              </p>

              {phase === 'countdown' && (
                <>
                  <p className="mt-6 font-athletic font-black uppercase tracking-tight leading-none text-[clamp(2rem,7vw,3.5rem)]">
                    {speakerChip(current.speaker, true)}, YOU&apos;RE UP
                  </p>
                  <p className="mt-3 text-sm text-chalk-3">
                    Arguing: <span className="text-chalk-2">{sideOf(current.speaker)}</span>
                  </p>
                  <div className="relative mx-auto mt-8 flex h-[clamp(6.5rem,26vw,11rem)] w-[clamp(6.5rem,26vw,11rem)] items-center justify-center">
                    <TurnRing remaining={clock} total={3} />
                    <p className="font-athletic font-black leading-none tabular-nums text-[clamp(3.5rem,16vw,6rem)] text-blaze-bright">
                      {Math.max(1, clock)}
                    </p>
                  </div>
                  <p className="mt-4 font-mono text-[10px] tracking-[0.3em] text-chalk-3 animate-pulse">
                    MIC GOES LIVE AT ZERO
                  </p>
                </>
              )}

              {phase === 'speaking' && (
                <>
                  <p className="mt-5 font-athletic font-black uppercase tracking-tight leading-none text-[clamp(2rem,7vw,3.5rem)]">
                    {speakerChip(current.speaker, true)}
                  </p>
                  <p className="mt-2 text-sm text-chalk-3">{ROUND_COPY[current.round].hint}</p>
                  <div className="relative mx-auto mt-8 flex h-[clamp(9rem,34vw,14rem)] w-[clamp(9rem,34vw,14rem)] items-center justify-center">
                    <TurnRing remaining={clock} total={turnSeconds} danger={liveClockDanger} />
                    <p
                      className={`font-athletic font-black leading-none tabular-nums text-[clamp(3rem,13vw,5.5rem)] ${
                        liveClockDanger ? 'text-red-400' : 'text-chalk'
                      }`}
                    >
                      {fmtClock(clock)}
                    </p>
                  </div>
                  <p className="mt-3 inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-red-400">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
                    RECORDING
                  </p>
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <Button type="button" onClick={endTurn}>
                      <Square size={14} weight="fill" aria-hidden />
                  DONE, NEXT
                    </Button>
                    <Button type="button" variant="secondary" onClick={togglePause}>
                      ❚❚ PAUSE
                    </Button>
                  </div>
                </>
              )}

              {phase === 'handoff' && (
                <>
                  <p className="mt-6 font-athletic font-black uppercase tracking-tight leading-none text-[clamp(2rem,7vw,3.5rem)]">
                    HAND IT TO {speakerChip(current.speaker, true)}
                  </p>
                  <p className="mt-3 text-sm text-chalk-3">
                    Up next: {ROUND_COPY[current.round].title.toLowerCase()} · arguing{' '}
                    <span className="text-chalk-2">{sideOf(current.speaker)}</span>
                  </p>
                  <p className="mt-8 font-athletic font-black leading-none tabular-nums text-[clamp(4rem,18vw,8rem)] text-chalk-2">
                    {fmtClock(clock)}
                  </p>
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <Button type="button" onClick={beginCountdown}>
                      ▶ START NOW
                    </Button>
                    <Button type="button" variant="secondary" onClick={togglePause}>
                      ❚❚ PAUSE
                    </Button>
                  </div>
                  {processingCount > 0 && (
                    <p className="mt-6 font-mono text-[10px] tracking-[0.3em] text-chalk-3 animate-pulse">
                      RUNNING EARLIER TAKES THROUGH THE BOOTH…
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Pause overlay */}
            {paused && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 rounded-card bg-ink/95">
                <p className="font-athletic font-black uppercase leading-none text-stroke text-[clamp(3rem,12vw,6rem)]">
                  Paused
                </p>
                <p className="font-mono text-[11px] tracking-[0.3em] text-chalk-3">
                  CLOCK FROZEN · MIC ON HOLD
                </p>
                <Button type="button" size="lg" onClick={togglePause}>
                  ▶ RESUME
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Wrap-up: waiting on the pipeline ── */}
        {(phase === 'wrapup' || phase === 'judging') && (
          <div className="bezel bezel-primary mt-10 p-6 md:p-8">
            <p className="font-mono text-xs tracking-[0.3em] text-blaze-bright">
              {phase === 'judging' ? 'THE JUDGE IS DELIBERATING…' : "THAT'S THE BALLGAME"}
            </p>
            <p className="mt-3 text-sm text-chalk-3">
              {phase === 'judging'
                ? 'All six takes are in. Scores incoming.'
                : 'Locking in the takes before the judge rules.'}
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
                    {slotLabel(slots[i])}
                    {slots[i].status === 'failed' && (
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

        {/* ── Verdict ── leads the page; the six turns fold into it. */}
        {phase === 'verdict' && verdict && (
          <VerdictPanel
            eyebrow="THE VERDICT · EXHIBITION"
            headline={
              verdict.winner === 'user'
                ? `${hostName} won.`
                : verdict.winner === 'opponent'
                  ? `${guestName} won.`
                  : 'Draw.'
            }
            topic={debate.topic_text}
            summary={`${hostName} ${verdict.user_score}, ${guestName} ${verdict.ai_score}.`}
            outcome={null}
            left={{
              name: hostName,
              side: hostSide,
              score: verdict.user_score,
              win: verdict.winner === 'user',
              rubric: verdict.breakdown?.user,
            }}
            right={{
              name: guestName,
              side: guestSide,
              score: verdict.ai_score,
              win: verdict.winner === 'opponent',
              rubric: verdict.breakdown?.ai,
            }}
            note={verdict.note}
            receipts={verdict.receipts}
            deepDive={verdict.deep_dive}
            deepDiveUnlocked={deepDiveUnlocked}
            isFounding={isFounding}
            surface="verdict_same_device"
            points={
              <p className="border-y border-line py-4 text-sm text-chalk-3">
                No points changed hands. Bragging rights are permanent.
              </p>
            }
            actions={
              // Same-device exhibition: the host owns the phone, so the viewer
              // is always the host seat.
              <VerdictNextStep
                share={{
                  debateId: debate.id,
                  score: verdict.user_score,
                  opponentScore: verdict.ai_score,
                  opponentName: guestName,
                  outcome:
                    verdict.winner === 'user' ? 'won' : verdict.winner === 'opponent' ? 'lost' : 'tied',
                  initialReceipts: debate.share_receipts !== false,
                  initialName: debate.share_name !== false,
                  initialRevoked: debate.share_revoked === true,
                }}
                rerunHref="/dashboard/debate/new"
                isFounding={isFounding}
                surface="verdict_same_device"
              />
            }
            rounds={rounds}
            nameOf={(s) => (s === 'host' ? hostName : guestName)}
            isLeft={(s) => s === 'host'}
            justLanded={!debate.verdict}
          />
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
