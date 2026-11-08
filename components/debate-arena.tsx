'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Circle, Medal, Square } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/button'
import { BADGE_ICONS } from '@/components/badge-chip'
import VerdictPanel, { JudgingCard, VerdictNextStep } from '@/components/verdict-panel'
import {
  nextTurn,
  ROUND_COPY,
  ROUND_ORDER,
  DIFFICULTY_META,
  DIFFICULTY_NAME,
  MAX_ROUND_CHARS,
  MAX_ROUND_SECONDS,
  TEXT_TURN_SECONDS,
  TEXT_TURN_FORFEIT,
  REDACTED_TURN_TEXT,
  moderationNoticeText,
  type RoundEntry,
  type RoundName,
  type Verdict,
  type Difficulty,
  type ModerationAction,
} from '@/lib/debate'
import { EVENTS, capture } from '@/lib/analytics'

// Mirrors AwardedBadge from lib/badge-award.ts. `upgraded` distinguishes a
// family levelling up from a badge earned for the first time, which otherwise
// look identical in this strip.
type NewBadge = {
  slug: string
  name: string
  description: string
  tier: number
  tierName: string
  upgraded: boolean
}

type Debate = {
  id: string
  topic_text: string
  user_side: string | null
  mode: 'text' | 'speech'
  difficulty: Difficulty
  is_random: boolean
  status: string
  rounds: RoundEntry[] | null
  verdict: Verdict | null
  user_score: number | null
  opponent_score: number | null
  winner: string | null
  points_earned: number | null
  share_revoked: boolean | null
  share_receipts: boolean | null
  share_name: boolean | null
}

// 'judge_failed' is its own phase because 'user_turn' cannot represent it. Once
// all six turns are in, nextTurn() is null, so the input dock and the retry
// button (both keyed off that turn) render nothing, and dropping back to
// 'user_turn' left the user staring at "hit retry" with no retry on the page and
// no way to recover it by reloading either.
type Phase = 'user_turn' | 'ai_thinking' | 'transcribing' | 'judging' | 'verdict' | 'judge_failed'

// Same fallback chain as pitchcoach's recorder: Safari can't do webm and
// throws NotSupportedError if you force it.
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return undefined
}

export default function DebateArena({
  debate,
  deepDiveUnlocked,
  isFounding = false,
}: {
  debate: Debate
  deepDiveUnlocked: boolean
  isFounding?: boolean
}) {
  const [rounds, setRounds] = useState<RoundEntry[]>(debate.rounds ?? [])
  const [verdict, setVerdict] = useState<Verdict | null>(debate.verdict)
  const [pointsEarned, setPointsEarned] = useState<number | null>(debate.points_earned)
  const [newBadges, setNewBadges] = useState<NewBadge[]>([])
  const [founding, setFounding] = useState(false)
  const [flagged, setFlagged] = useState(false)
  const [flagSeverity, setFlagSeverity] = useState<'slur' | 'profanity' | null>(null)
  const [moderationWarning, setModerationWarning] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  // In flight to /api/debate/round. The ref is the guard (synchronous, so two
  // taps in the same tick cannot both pass it); the state drives the button.
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  // Set when the mic is refused mid-debate. The row's `mode` is immutable and
  // the ticket is already spent, so the only humane recovery is to let this
  // debate finish by typing. The round route does not care how the text
  // arrived.
  const [forceText, setForceText] = useState(false)
  // A row with every turn in and no verdict is a debate whose judging did not
  // land, which is exactly the state a reload used to get permanently stuck in.
  // It opens in 'judging' and the effect below retries once, so refreshing the
  // page is itself the recovery.
  const [phase, setPhase] = useState<Phase>(
    debate.verdict
      ? 'verdict'
      : nextTurn(debate.rounds ?? []) === null
        ? 'judging'
        : 'user_turn'
  )

  // Speech state
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Text-turn countdown: each text turn is on a fixed clock; on zero, whatever
  // is in the box submits automatically (see the effect below).
  const [textRemaining, setTextRemaining] = useState(TEXT_TURN_SECONDS)
  const textTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const turn = nextTurn(rounds)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Follows the transcript down while the debate is on. Not once the verdict is
  // in: the verdict panel scrolls its own top into view, and this used to run
  // after it and drag the page to the bottom of the card.
  useEffect(() => {
    if (phase === 'verdict') return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [rounds, phase])

  // Seconds since the judge was called, for the wait card.
  const [judgeElapsed, setJudgeElapsed] = useState(0)
  useEffect(() => {
    if (phase !== 'judging') return
    const id = setInterval(() => setJudgeElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [phase])

  // If the page loads mid-debate with the AI owing a response (e.g. refresh
  // after a failed opponent call), let the user retry via the button below.
  const aiOwesResponse = turn?.speaker === 'ai' && phase === 'user_turn'

  const saveUserRound = async (text: string) => {
    const clean = text.trim()
    if (!clean) {
      setError('Say something. The judge cannot score silence.')
      return
    }
    if (!turn || turn.speaker !== 'user') return
    // `turn` is derived from `rounds`, which does not update until the POST
    // resolves, so it is not a re-entry guard: between the tap and the response
    // the dock is unchanged, the draft is still in the box and SEND IT is still
    // live. The round route moderates before it saves, so that window is a real
    // second or two on mobile data, and a second tap posts the same turn twice
    // into a three-round debate. The 0:00 auto-submit can also land inside it.
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setError('')

    // We are committing this turn: stop the countdown so it can't fire a second
    // (duplicate) auto-submit while this request is in flight.
    if (textTimerRef.current) {
      clearInterval(textTimerRef.current)
      textTimerRef.current = null
    }

    // Server-side round submission: it moderates the text (inappropriate
    // language is an automatic loss) before saving, so this can't be bypassed.
    try {
      const res = await fetch('/api/debate/round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debateId: debate.id, text: clean }),
      })
      if (!res.ok) throw new Error(`round ${res.status}`)
      const data = await res.json()

      if (data.flagged) {
        setRounds((prev) => [
          ...prev,
          { round: turn.round, speaker: 'user', text: REDACTED_TURN_TEXT },
        ])
        setVerdict(data.verdict)
        setPointsEarned(typeof data.pointsEarned === 'number' ? data.pointsEarned : null)
        setNewBadges([])
        setFlagged(true)
        setFlagSeverity(data.moderation?.severity ?? null)
        setDraft('')
        setPhase('verdict')
        return
      }

      const updated = data.rounds as RoundEntry[]
      setRounds(updated)
      setDraft('')
      // Warn / deduct: the turn was redacted but the debate continues. Surface
      // a banner, then proceed to the AI's response as normal.
      if (data.moderation) {
        setModerationWarning(
          moderationNoticeText(data.moderation.action as ModerationAction, data.moderation.penalty ?? 0)
        )
      } else {
        setModerationWarning(null)
      }
      await requestAiRound(updated)
    } catch {
      setError('Failed to save your argument. Try again.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const requestAiRound = async (current: RoundEntry[]) => {
    setPhase('ai_thinking')
    try {
      const res = await fetch('/api/debate/opponent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debateId: debate.id }),
      })
      if (!res.ok) throw new Error(`opponent ${res.status}`)
      const { round, text } = await res.json()
      const updated: RoundEntry[] = [...current, { round, speaker: 'ai', text }]
      setRounds(updated)

      if (nextTurn(updated) === null) {
        await requestVerdict()
      } else {
        setPhase('user_turn')
      }
    } catch {
      setError('The AI lost its train of thought. Hit retry.')
      setPhase('user_turn')
    }
  }

  const requestVerdict = async () => {
    setJudgeElapsed(0)
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
      if (typeof data.pointsEarned === 'number') setPointsEarned(data.pointsEarned)
      if (Array.isArray(data.newBadges)) setNewBadges(data.newBadges)
      setFounding(Boolean(data.founding))
      // The retention number. Fired at the verdict, not at the last round,
      // because a debate the judge never scored is a debate the user did not
      // finish, and that is the difference the funnel needs to see.
      capture(EVENTS.DEBATE_COMPLETED, {
        mode: 'ai',
        format: debate.mode,
        difficulty: debate.difficulty,
        is_random: debate.is_random,
        // 'draw' matches the online arena, which already reported it. Logging a
        // tie as a loss here would have quietly understated the win rate.
        outcome:
          data.verdict?.winner === 'none'
            ? 'draw'
            : data.verdict?.winner === 'user'
              ? 'win'
              : 'loss',
        score: data.verdict?.user_score,
        points_earned: data.pointsEarned,
      })
      setPhase('verdict')
    } catch {
      setError('The judge stepped out. Your debate is saved, hit retry.')
      setPhase('judge_failed')
    }
  }

  // Recover a debate that finished but never got scored. Fires at most once per
  // mount, so a reload retries the judge instead of stranding the user. Safe to
  // re-run: the judge route is idempotent and hands back the stored verdict if
  // one already exists.
  const autoJudgedRef = useRef(false)
  useEffect(() => {
    if (autoJudgedRef.current) return
    if (debate.verdict) return
    if (nextTurn(debate.rounds ?? []) !== null) return
    autoJudgedRef.current = true
    void requestVerdict()
    // Mount-only on purpose: this is a recovery path, not a reaction to state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Speech recording ────────────────────────────────────────────
  const startRecording = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 }
      )
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        void transcribeAndSubmit(blob)
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => {
        setElapsed((s) => {
          if (s + 1 >= MAX_ROUND_SECONDS) stopRecording()
          return s + 1
        })
      }, 1000)
    } catch (err) {
      // The old copy told the user to "switch to a text debate" on a screen
      // with no such control: `debate.mode` comes off an immutable row and
      // nothing in this file sets it. The ticket is already spent, so offer the
      // switch instead of naming it.
      const name = err instanceof DOMException ? err.name : ''
      setError(
        name === 'NotFoundError' || name === 'OverconstrainedError'
          ? 'No microphone found. You can finish this one by typing instead.'
          : 'Your browser is blocking the mic. Allow it in site settings, or finish this one by typing instead.'
      )
      setForceText(true)
    }
  }

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    setRecording(false)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  const transcribeAndSubmit = async (blob: Blob) => {
    setPhase('transcribing')
    try {
      const form = new FormData()
      form.append('audio', blob, 'round.webm')
      const res = await fetch('/api/debate/transcribe', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`transcribe ${res.status}`)
      const { transcriptId } = await res.json()

      // Poll every 2s, up to 90s.
      for (let i = 0; i < 45; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const poll = await fetch(`/api/debate/transcribe?id=${transcriptId}`)
        if (!poll.ok) continue
        const data = await poll.json()
        if (data.status === 'completed') {
          if (!data.text?.trim()) {
            setError('Could not hear anything on that take. Run it back.')
            setPhase('user_turn')
            return
          }
          setPhase('user_turn')
          await saveUserRound(data.text)
          return
        }
        if (data.status === 'error') throw new Error('transcription error')
      }
      throw new Error('transcription timeout')
    } catch {
      setError('Transcription failed. Run that take back.')
      setPhase('user_turn')
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (textTimerRef.current) clearInterval(textTimerRef.current)
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    }
  }, [])

  // Text-turn countdown. Restarts whenever a fresh text turn begins (the round
  // changes, or the turn comes back to the user). At zero it auto-submits the
  // current draft, or a forfeit placeholder if the box is empty. Speech turns
  // have their own recording cap, so this is gated to text mode only.
  // `forceText` folds the mic-refused recovery into the same branch, so the
  // text dock, its clock and its character counter all come along rather than
  // being reimplemented for the fallback.
  const typing = debate.mode === 'text' || forceText
  const isTextUserTurn = typing && phase === 'user_turn' && turn?.speaker === 'user'
  const textTurnRound = isTextUserTurn ? turn?.round : null
  // The clock runs only once the round is ARMED. Opening a debate does not arm
  // it, and a round is disarmed again whenever the tab is hidden.
  //
  // This effect used to fire on mount. The deck's list is the only way back
  // into an unfinished debate, so tapping one silently started a 180-second
  // countdown and, at zero, wrote TEXT_TURN_FORFEIT into the transcript for the
  // judge to score. Opening the debate to remind yourself of the topic and then
  // getting pulled into a conversation cost you the round, and a phone hitting
  // its lock screen did the same. Nothing asked, nothing warned, no undo.
  //
  // Disarming on hide is not a loophole: the clock was never an integrity
  // mechanism. It is a client-side setInterval with no server deadline behind
  // it, so closing the tab already stopped it dead. Making that explicit just
  // stops it punishing the one user who came back.
  const [armed, setArmed] = useState(() => (debate.rounds ?? []).length === 0)
  useEffect(() => {
    if (!isTextUserTurn) return
    const onHide = () => {
      if (document.visibilityState === 'hidden') setArmed(false)
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [isTextUserTurn])

  useEffect(() => {
    if (!isTextUserTurn || !armed) return
    // A new turn = a fresh clock. Synchronizing the countdown to the turn is
    // exactly what this effect is for; the set-state-in-effect rule is waived
    // here as it is for the H2H turn timer in versus-arena.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTextRemaining(TEXT_TURN_SECONDS)
    const id = setInterval(() => {
      setTextRemaining((s) => {
        if (s <= 1) {
          clearInterval(id)
          textTimerRef.current = null
          // draftRef holds the latest text; the box may be empty -> forfeit.
          void saveUserRound(draftRef.current.trim() || TEXT_TURN_FORFEIT)
          return 0
        }
        return s - 1
      })
    }, 1000)
    textTimerRef.current = id
    return () => clearInterval(id)
    // saveUserRound/draft are read through stable refs; restart only per turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTextUserTurn, textTurnRound, armed])

  const fmtClock = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const roundLabel = (r: RoundName) => ROUND_COPY[r].title

  // ── Verdict, from the viewer's seat ─────────────────────────────
  const showVerdict = phase === 'verdict' && verdict !== null
  // Mounted without a verdict means it arrived while the page was open, so the
  // panel scrolls itself into view and announces the result. A reopened
  // debate already opens on it.
  const justLanded = !debate.verdict
  const outcome: 'won' | 'lost' | 'draw' =
    flagged || verdict?.winner === 'opponent' ? 'lost' : verdict?.winner === 'user' ? 'won' : 'draw'
  const boosted = founding || isFounding
  const pointsCaption =
    pointsEarned === null
      ? ''
      : pointsEarned > 0
        ? `${DIFFICULTY_NAME[debate.difficulty]} win${debate.is_random ? ', random topic' : ''}${boosted ? ', founder boost' : ''}`
        : pointsEarned < 0
          ? flagged
            ? 'Automatic loss'
            : `${DIFFICULTY_NAME[debate.difficulty]} loss`
          : 'No points move on a draw'

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="relative min-h-dvh bg-ink text-chalk">
      <div className="grain" aria-hidden />

      <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur-sm">
        {/* The same small lockup as the hub header. The old 56px mark and
            32px wordmark left the mode label three lines tall on a phone. */}
        <div
          className={`mx-auto flex h-14 items-center justify-between gap-3 px-5 ${
            showVerdict ? 'max-w-6xl' : 'max-w-4xl'
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
          {showVerdict ? (
            <a
              href="/dashboard"
              className="inline-flex min-h-[44px] items-center px-1 text-sm font-semibold text-chalk-2 transition-colors hover:text-chalk"
            >
              Locker room
            </a>
          ) : (
            <span className="text-right font-mono text-[10px] tracking-[0.25em] text-chalk-3">
              {debate.mode === 'speech' ? 'SPEECH' : 'TEXT'} · VS THE AI
            </span>
          )}
        </div>
      </header>

      <main
        className={`mx-auto px-5 ${showVerdict ? 'max-w-6xl py-8 pb-16' : 'max-w-4xl py-10 pb-40'}`}
      >
        {showVerdict && verdict ? (
          <VerdictPanel
            eyebrow={`THE VERDICT · ${DIFFICULTY_META[debate.difficulty].label}`}
            headline={outcome === 'won' ? 'You won.' : outcome === 'lost' ? 'You lost.' : 'Draw.'}
            topic={debate.topic_text}
            summary={`${verdict.user_score} to ${verdict.ai_score}.${
              debate.user_side ? ` You argued ${debate.user_side}.` : ''
            }`}
            outcome={outcome}
            left={{
              name: 'You',
              side: debate.user_side,
              score: verdict.user_score,
              win: verdict.winner === 'user' && !flagged,
              rubric: verdict.breakdown?.user,
            }}
            right={{
              name: 'The AI',
              side: debate.user_side ? 'the other side' : null,
              score: verdict.ai_score,
              win: verdict.winner === 'opponent' || flagged,
              rubric: verdict.breakdown?.ai,
            }}
            note={verdict.note}
            receipts={verdict.receipts}
            deepDive={verdict.deep_dive}
            deepDiveUnlocked={deepDiveUnlocked}
            isFounding={boosted}
            surface="verdict_ai"
            notice={
              flagged ? (
                <div className="rounded-card border border-blaze/45 bg-steel/30 p-4">
                  <p className="font-mono text-[10px] font-bold tracking-[0.25em] text-blaze-bright">
                    {flagSeverity === 'slur' ? 'HATE SPEECH · AUTOMATIC LOSS' : 'FLAGGED · AUTOMATIC LOSS'}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-chalk-2">
                    {flagSeverity === 'slur'
                      ? 'Slurs are an automatic loss, no warnings. That language has no place here.'
                      : 'Repeated inappropriate language ended this debate after warnings. Keep it clean.'}
                  </p>
                </div>
              ) : undefined
            }
            points={
              pointsEarned !== null ? (
                <div className="flex items-center justify-between gap-4 border-y border-line py-4">
                  <span className="text-sm text-chalk-3">{pointsCaption}</span>
                  <span
                    className={`font-athletic text-3xl font-black leading-none tabular-nums ${
                      pointsEarned > 0 ? 'text-blaze-bright' : 'text-chalk-2'
                    }`}
                  >
                    {pointsEarned > 0 ? `+${pointsEarned}` : pointsEarned}
                    <span className="sr-only"> points</span>
                  </span>
                </div>
              ) : undefined
            }
            badges={
              newBadges.length > 0 ? (
                <div className="bezel p-5">
                  <p className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-blaze-bright">
                    {newBadges.every((b) => b.upgraded)
                      ? `BADGE${newBadges.length > 1 ? 'S' : ''} LEVELLED UP`
                      : `BADGE${newBadges.length > 1 ? 'S' : ''} UNLOCKED`}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {newBadges.map((b) => {
                      const Glyph = BADGE_ICONS[b.slug] ?? Medal
                      return (
                        <span
                          key={b.slug}
                          title={b.description}
                          className="inline-flex items-center gap-2 rounded-lg border border-blaze/50 bg-steel/25 px-3 py-2 text-sm font-semibold text-chalk"
                        >
                          <Glyph size={16} weight="fill" className="text-blaze-bright" />
                          {b.name}
                          {b.tierName && (
                            <span className="font-mono text-[10px] tracking-[0.2em] text-blaze-bright">
                              {b.tierName.toUpperCase()}
                            </span>
                          )}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ) : undefined
            }
            actions={
              <VerdictNextStep
                share={{
                  debateId: debate.id,
                  score: verdict.user_score,
                  opponentScore: verdict.ai_score,
                  opponentName: 'the AI',
                  outcome: outcome === 'won' ? 'won' : outcome === 'lost' ? 'lost' : 'tied',
                  initialReceipts: debate.share_receipts !== false,
                  initialName: debate.share_name !== false,
                  initialRevoked: debate.share_revoked === true,
                }}
                rerunHref="/dashboard/debate/new"
                isFounding={boosted}
                surface="verdict_ai"
              />
            }
            rounds={rounds}
            nameOf={(s) => (s === 'user' ? 'You' : 'The AI')}
            isLeft={(s) => s === 'user'}
            justLanded={justLanded}
          />
        ) : (
          <>
        <p className="font-mono text-xs tracking-[0.3em] text-blaze-bright">THE TOPIC</p>
        <h1 className="mt-2 font-athletic font-black uppercase leading-[0.95] tracking-tight text-[clamp(1.75rem,5vw,3rem)]">
          {debate.topic_text}
        </h1>
        <p className="mt-2 font-mono text-[11px] tracking-[0.2em] text-chalk-3">
          YOU ARGUE: {debate.user_side?.toUpperCase() ?? 'YOUR SIDE'} · AI TAKES THE OTHER SIDE
        </p>
        <span className="mt-3 inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] text-blaze-bright">
          {DIFFICULTY_META[debate.difficulty].label} · {DIFFICULTY_META[debate.difficulty].multiplier}x POINTS
        </span>

        {moderationWarning && phase !== 'verdict' && (
          <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            {moderationWarning}
          </p>
        )}

        {/* Transcript */}
        <div className="mt-10 space-y-5">
          {rounds.map((r, i) => (
            <div
              key={i}
              className={`rounded-card border p-6 ${
                r.speaker === 'user'
                  ? 'border-blaze/40 bg-steel/20'
                  : 'border-line bg-panel'
              }`}
            >
              <p className="font-mono text-[10px] tracking-[0.3em] text-chalk-3">
                {roundLabel(r.round)} · {r.speaker === 'user' ? 'YOU' : 'THE AI'}
              </p>
              <p className="mt-3 leading-relaxed text-chalk-2 whitespace-pre-wrap">{r.text}</p>
            </div>
          ))}

          {phase === 'ai_thinking' && (
            <div className="rounded-card border border-line bg-panel p-6">
              <p className="font-mono text-[10px] tracking-[0.3em] text-blaze-bright animate-pulse">
                THE AI IS COOKING UP A RESPONSE…
              </p>
            </div>
          )}
          {phase === 'transcribing' && (
            <div className="rounded-card border border-line bg-panel p-6">
              <p className="font-mono text-[10px] tracking-[0.3em] text-blaze-bright animate-pulse">
                RUNNING YOUR TAKE THROUGH THE BOOTH…
              </p>
            </div>
          )}
          {phase === 'judging' && <JudgingCard elapsed={judgeElapsed} opponent="The AI" />}
        </div>
          </>
        )}

        {error && (
          <p role="alert" className="mt-6 text-sm text-red-400">
            {error}
            {(aiOwesResponse || phase === 'judge_failed') && (
              <button
                type="button"
                onClick={
                  phase === 'judge_failed' ? requestVerdict : () => requestAiRound(rounds)
                }
                className="-my-2 ml-3 inline-block px-2 py-3 font-semibold text-blaze-bright hover:underline"
              >
                Retry
              </button>
            )}
          </p>
        )}

        <div ref={bottomRef} />
      </main>

      {/* Input dock.
          pb-[env(safe-area-inset-bottom)] matches the app's two other fixed
          bottom bars. Without it the SEND IT button and the bottom of the
          textarea sit in the iOS home-indicator gesture strip, on the one
          screen where a mistap costs the round. */}
      {phase === 'user_turn' && turn?.speaker === 'user' && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm">
          <div className="mx-auto max-w-4xl px-5 py-4">
            {/* Position in the format, which the H2H arena has always shown and
                this one never did. A first-timer is told to write a CONTENTION
                with nothing on screen saying three rounds exist, so they cannot
                judge how much of their case to spend now, which is the whole
                strategic decision the format is built on. */}
            <p className="font-mono text-[10px] tracking-[0.3em] text-blaze-bright">
              ROUND {ROUND_ORDER.indexOf(turn.round) + 1} OF {ROUND_ORDER.length} ·{' '}
              {roundLabel(turn.round)}
            </p>
            <p className="mt-1 font-mono text-[10px] tracking-[0.25em] text-chalk-3">
              {ROUND_COPY[turn.round].hint}
            </p>

            {typing ? (
              <>
              {!armed && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button type="button" onClick={() => setArmed(true)}>
                    START THIS ROUND
                  </Button>
                  <span className="font-mono text-[11px] tracking-[0.2em] text-chalk-3">
                    {fmtClock(TEXT_TURN_SECONDS)} ON THE CLOCK ONCE YOU DO
                  </span>
                </div>
              )}
              <div
                className={`mt-2 flex items-center gap-2 font-mono text-[11px] tabular-nums tracking-[0.2em] ${
                  armed ? '' : 'opacity-40'
                }`}
              >
                <span className={armed && textRemaining <= 30 ? 'text-red-400' : 'text-chalk-2'}>
                  {fmtClock(armed ? textRemaining : TEXT_TURN_SECONDS)} LEFT
                </span>
                {armed && textRemaining <= 30 && (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" aria-hidden />
                )}
                <span className="text-chalk-3">· AUTO-SUBMITS AT 0:00</span>
                <span
                  id="round-take-limit"
                  className={`ml-auto tabular-nums ${
                    draft.length > MAX_ROUND_CHARS * 0.9 ? 'text-blaze-bright' : 'text-chalk-3'
                  }`}
                >
                  {draft.length}/{MAX_ROUND_CHARS}
                </span>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void saveUserRound(draft)
                }}
                className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
              >
                {/* The Daily's identical box has a label, a counter and a
                    chalk-3 placeholder; this one had none of the three. An
                    unlabelled edit box announces as "edit text" with only
                    "Cook." as a hint, maxLength truncates a long paste in
                    silence, and text-chalk/50 sits under the chalk-3 floor
                    globals.css sets for anything carrying meaning. */}
                <label htmlFor="round-take" className="sr-only">
                  Your {roundLabel(turn.round).toLowerCase()}
                </label>
                <textarea
                  id="round-take"
                  name="take"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={MAX_ROUND_CHARS}
                  rows={3}
                  aria-describedby="round-take-limit"
                  placeholder="Open with your strongest point, then back it with a number…"
                  className="min-h-24 w-full flex-1 resize-y rounded-card border border-line-strong bg-panel px-4 py-3 text-chalk placeholder:text-chalk-3 focus:border-blaze/60"
                />
                <Button type="submit" className="shrink-0" disabled={submitting} aria-busy={submitting}>
                  {submitting ? 'SENDING…' : 'SEND IT'}
                </Button>
              </form>
              </>
            ) : (
              <div className="mt-3 flex items-center gap-4">
                {recording ? (
                  <>
                    <Button type="button" variant="danger" onClick={stopRecording}>
                      <Square size={14} weight="fill" aria-hidden />
                  STOP &amp; SUBMIT
                    </Button>
                    <span className="font-mono text-sm tabular-nums text-chalk-2">
                      {fmtClock(elapsed)} / {fmtClock(MAX_ROUND_SECONDS)}
                    </span>
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
                  </>
                ) : (
                  <Button type="button" onClick={startRecording}>
                    <Circle size={14} weight="fill" aria-hidden />
                  START TALKING
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
