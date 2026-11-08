'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, buttonClasses } from '@/components/ui/button'
import { ScoreRing } from '@/components/score-ring'
import { RadioCards } from '@/components/ui/radio-cards'
import { Check, Circle, Square } from '@phosphor-icons/react/dist/ssr'
import { MAX_DAILY_CHARS, MAX_DAILY_SECONDS, DAILY_WIN_BONUS } from '@/lib/debate'
import { EVENTS, capture } from '@/lib/analytics'

type Breakdown = { facts: number; logic: number; delivery: number; note: string }
type Attempt = { score: number; side: string | null; breakdown: Breakdown | null }
type BoardRow = { user_id: string; username: string; score: number }

// 'open' days carry no stances (a DB check constraint guarantees it), so the
// side picker has nothing to render and the copy that tells you to pick one
// would be instructions for a control that is not there.
type Prompt = {
  id: string
  format: 'sides' | 'open'
  topic: string
  stance_a: string | null
  stance_b: string | null
}

// Same mime fallback chain as the debate arena (Safari can't do webm).
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return undefined
}

type Phase = 'take' | 'transcribing' | 'grading'

// "The board locks at midnight UTC" was 5pm on the west coast, and every
// other clock in the app is relative. The day is a UTC date (lib/daily.ts), so
// this counts down to the next 00:00 UTC. Rendered after mount: the server's
// clock and the reader's would disagree, which is a hydration mismatch.
function LockLine() {
  const [text, setText] = useState('One take a day.')
  useEffect(() => {
    const update = () => {
      const now = new Date()
      const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
      const mins = Math.max(1, Math.round((next - now.getTime()) / 60000))
      const h = Math.floor(mins / 60)
      const m = mins % 60
      setText(`The board locks in ${h > 0 ? `${h}h ${m}m` : `${m} min`}.`)
    }
    update()
    const t = setInterval(update, 60_000)
    return () => clearInterval(t)
  }, [])
  return <>{text}</>
}

// The share for a Daily take. There is no Daily card or permalink, so this
// sends a sentence and the site: the native share sheet on a phone, the
// clipboard elsewhere.
function ShareTake({ score, topic }: { score: number; topic: string }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const url = window.location.origin
    const text = `I scored ${score} on today's Heated Daily: "${topic}" Think you can beat it?`
    try {
      if (navigator.share) {
        await navigator.share({ text, url })
        capture(EVENTS.VERDICT_SHARED, { surface: 'daily', channel: 'native' })
        return
      }
      await navigator.clipboard.writeText(`${text} ${url}`)
      setCopied(true)
      capture(EVENTS.VERDICT_SHARED, { surface: 'daily', channel: 'copy' })
    } catch {
      // A dismissed share sheet throws AbortError; nothing to report.
    }
  }
  return (
    <Button type="button" size="lg" className="w-full sm:w-auto" onClick={() => void share()}>
      {copied ? 'COPIED' : 'SHARE YOUR TAKE'}
    </Button>
  )
}

export default function DailyArena({
  prompt,
  myAttempt,
  board,
  myUserId,
}: {
  prompt: Prompt
  myAttempt: Attempt | null
  board: BoardRow[]
  myUserId: string
}) {
  const router = useRouter()
  const isOpen = prompt.format === 'open'
  const [attempt, setAttempt] = useState<Attempt | null>(myAttempt)
  const [mode, setMode] = useState<'text' | 'speech'>('text')
  const [side, setSide] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [phase, setPhase] = useState<Phase>('take')
  const [error, setError] = useState('')

  // Speech state
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    }
  }, [])

  const submit = async (argument: string) => {
    const clean = argument.trim()
    if (!clean) {
      setError('Say something. The judge cannot score silence.')
      setPhase('take')
      return
    }
    setError('')
    setPhase('grading')
    try {
      const res = await fetch('/api/daily/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ argument: clean, side: isOpen ? null : side }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.flagged) {
          setError('Keep it clean. That take got flagged. Rewrite it and try again.')
        } else if (data.alreadyPlayed) {
          setError('You already took your shot today.')
          router.refresh()
        } else {
          setError('The judge stepped out. Try again in a sec.')
        }
        setPhase('take')
        return
      }
      capture(EVENTS.DAILY_ATTEMPT_SUBMITTED, {
        score: data.score,
        format: mode,
        picked_side: Boolean(side),
      })
      setAttempt({ score: data.score, side, breakdown: data.breakdown })
      setPhase('take')
      // Reflect the new score on the board (and everyone else's since).
      router.refresh()
    } catch {
      setError('Something went wrong scoring your take. Try again.')
      setPhase('take')
    }
  }

  // ── Speech recording (mirrors the debate arena) ──────────────────
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
          if (s + 1 >= MAX_DAILY_SECONDS) stopRecording()
          return s + 1
        })
      }, 1000)
    } catch {
      setError('Microphone access denied. Allow the mic or type your take instead.')
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
      form.append('audio', blob, 'take.webm')
      const res = await fetch('/api/debate/transcribe', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`transcribe ${res.status}`)
      const { transcriptId } = await res.json()

      for (let i = 0; i < 45; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const poll = await fetch(`/api/debate/transcribe?id=${transcriptId}`)
        if (!poll.ok) continue
        const data = await poll.json()
        if (data.status === 'completed') {
          if (!data.text?.trim()) {
            setError('Could not hear anything on that take. Run it back.')
            setPhase('take')
            return
          }
          await submit(data.text)
          return
        }
        if (data.status === 'error') throw new Error('transcription error')
      }
      throw new Error('transcription timeout')
    } catch {
      setError('Transcription failed. Run that take back.')
      setPhase('take')
    }
  }

  const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const myRank = attempt ? board.findIndex((r) => r.user_id === myUserId) + 1 : 0

  return (
    <div className="mt-8 space-y-10">
      {/* The prompt is this screen's deck: it is the thing the whole page is
          about, so it gets the one red-glowing surface and the one texture.
          Across the five hub screens bezel-primary gives way to bezel-deck,
          whose shadow is actually visible on a near-black canvas. It still
          belongs on modals and the landing, where a glow is the point. */}
      <div className="reveal r2 bezel bezel-deck relative overflow-hidden p-6 md:p-8">
        <div className="grid-texture absolute inset-0" aria-hidden />
        <div className="relative">
          <p className="font-mono text-[10px] font-bold tracking-[0.3em] text-blaze-bright">
            TODAY&apos;S PROMPT
          </p>
          <h2 className="mt-3 font-athletic text-2xl font-black uppercase leading-tight tracking-tight md:text-3xl">
            {prompt.topic}
          </h2>
          {/* An open day has no stances, so this row would render two empty
              pills either side of a "vs". The OPEN TAKE tag replaces it rather
              than leaving a gap: the reader still needs to be told which kind of
              day this is, and the absence of sides is the whole point of it. */}
          {isOpen ? (
            <p className="mt-4 inline-flex items-center rounded-full border border-blaze/40 px-3 py-1 font-mono text-[11px] tracking-widest text-blaze-bright">
              OPEN TAKE · NO SIDES
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2 font-mono text-[11px] tracking-widest text-chalk-3">
              <span className="rounded-full border border-line-strong px-3 py-1">
                {prompt.stance_a}
              </span>
              <span className="text-chalk-3">vs</span>
              <span className="rounded-full border border-line-strong px-3 py-1">
                {prompt.stance_b}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Take input OR your result */}
      {attempt ? (
        <div className="bezel pop-in overflow-hidden">
          <div className="border-b border-line px-6 py-4 font-mono text-xs tracking-[0.25em] text-chalk-3">
            YOUR TAKE IS IN
          </div>
          <div className="flex flex-col gap-6 px-6 py-8 sm:flex-row sm:items-center">
            <ScoreRing score={attempt.score} win={attempt.score >= 80} />
            <div className="min-w-0">
              {/* findIndex is -1 outside the top 25 the board loads, which used
                  to read "ON THE BOARD" to someone who was not on it. */}
              <p className="text-sm font-semibold text-chalk">
                {myRank > 0 ? `#${myRank} today` : "Outside today's top 25"}
                {attempt.side ? <span className="font-normal text-chalk-3"> · you argued {attempt.side}</span> : null}
              </p>
              {attempt.breakdown?.note && (
                <p className="mt-2 leading-relaxed text-chalk-2">{attempt.breakdown.note}</p>
              )}
              {attempt.breakdown && (
                <p className="mt-3 text-sm tabular-nums text-chalk-3">
                  Facts {attempt.breakdown.facts} · Logic {attempt.breakdown.logic} · Delivery{' '}
                  {attempt.breakdown.delivery}
                </p>
              )}
            </div>
          </div>
          <p className="border-t border-line px-6 py-4 text-sm text-chalk-3">
            <LockLine /> The day&apos;s top score takes{' '}
            <span className="font-semibold text-blaze-bright">+{DAILY_WIN_BONUS} points</span>, and a
            fresh question lands after that.
          </p>
          {/* The moment someone has just played is the moment they are most
              into it, and the only ways out used to be Locker room and Career
              board. Now: send the take, or argue the same question properly. */}
          <div className="flex flex-col gap-2.5 border-t border-line px-6 py-5 sm:flex-row">
            <ShareTake score={attempt.score} topic={prompt.topic} />
            <Link
              href={`/dashboard/debate/new?daily=${prompt.id}`}
              className={buttonClasses('secondary', 'lg', 'w-full sm:w-auto')}
            >
              {/* The ticket cost is on the setup screen before anything is
                  spent; with it here the label ran past the button at 375. */}
              Debate it vs the AI
            </Link>
          </div>
        </div>
      ) : (
        <div>
          <p className="font-mono text-[11px] tracking-[0.3em] text-chalk-3">
            YOUR TAKE · ONE SHOT
          </p>
          <p className="mt-2 text-sm text-chalk-3">
            {isOpen
              ? 'No sides today. Say what you actually think, and back it up.'
              : 'Pick a side (or argue your own), make your case.'}{' '}
            The judge scores facts, logic, and delivery. Top score today wins{' '}
            {DAILY_WIN_BONUS} points.
          </p>

          {/* Optional side pick. These are TOGGLES, not radios: tapping the
              selected one clears it back to null, and a radiogroup cannot be
              empty. aria-pressed is the honest role.

              Absent entirely on an open day rather than rendered empty. Offering
              positions is the thing that makes people pick one instead of saying
              what they think, and a supplied position is the one answer
              guaranteed not to be a hot take. */}
          {!isOpen && (
            <div
              role="group"
              aria-label="Pick a side (optional)"
              className="mt-4 flex flex-wrap gap-3"
            >
              {[prompt.stance_a, prompt.stance_b]
                .filter((s): s is string => Boolean(s))
                .map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={side === s}
                    onClick={() => setSide(side === s ? null : s)}
                    className={`press inline-flex min-h-[44px] items-center gap-2 rounded-card border px-4 py-2.5 text-left text-sm transition-colors ${
                      side === s
                        ? 'border-blaze bg-steel/60 text-chalk'
                        : 'border-line-strong text-chalk-2 hover:border-blaze/50'
                    }`}
                  >
                    {side === s && (
                      <span
                        aria-hidden
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blaze text-white"
                      >
                        <Check size={10} weight="bold" />
                      </span>
                    )}
                    {s}
                  </button>
                ))}
            </div>
          )}

          <RadioCards<'text' | 'speech'>
            legend="HOW YOU TAKING IT"
            value={mode}
            onChange={setMode}
            columns="sm:grid-cols-2"
            className="mt-5"
            options={[
              { value: 'text', title: 'TEXT', desc: 'Type your take. Edit before you send.' },
              { value: 'speech', title: 'SPEECH', desc: 'Talk your talk. 2:00 on the mic.' },
            ]}
          />

          {/* Input */}
          {phase === 'grading' || phase === 'transcribing' ? (
            <div className="mt-5 rounded-card border border-blaze/40 bg-panel p-6">
              <p className="font-mono text-[10px] tracking-[0.3em] text-blaze-bright animate-pulse">
                {phase === 'transcribing'
                  ? 'RUNNING YOUR TAKE THROUGH THE BOOTH…'
                  : 'THE JUDGE IS SCORING YOUR TAKE…'}
              </p>
            </div>
          ) : mode === 'text' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void submit(draft)
              }}
              className="mt-5 flex flex-col gap-3"
            >
              <label
                htmlFor="daily-take"
                className="font-mono text-[10px] font-bold tracking-[0.3em] text-chalk-3"
              >
                YOUR TAKE
              </label>
              <textarea
                id="daily-take"
                name="take"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={MAX_DAILY_CHARS}
                rows={5}
                placeholder="Pick a side and back it with one real number."
                aria-describedby="daily-take-limit"
                className="min-h-36 w-full resize-y rounded-card border border-line-strong bg-panel px-4 py-3 text-chalk placeholder:text-chalk-3 focus:border-blaze/60"
              />
              <p id="daily-take-limit" className="font-mono text-[10px] tracking-[0.2em] text-chalk-3">
                {draft.length} / {MAX_DAILY_CHARS}
              </p>
              <Button type="submit" className="self-start">
                SEND IT
              </Button>
            </form>
          ) : (
            <div className="mt-5 flex items-center gap-4">
              {recording ? (
                <>
                  <Button type="button" variant="danger" onClick={stopRecording}>
                    <Square size={14} weight="fill" aria-hidden />
                  STOP &amp; SUBMIT
                  </Button>
                  <span className="font-mono text-sm tabular-nums text-chalk-2">
                    {fmtClock(elapsed)} / {fmtClock(MAX_DAILY_SECONDS)}
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
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      {/* Daily leaderboard */}
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-mono text-xs tracking-[0.3em] text-chalk-3">TODAY&apos;S BOARD</p>
          <p className="font-mono text-[11px] tracking-widest text-chalk-3">
            TOP SCORE WINS +{DAILY_WIN_BONUS}
          </p>
        </div>

        {board.length === 0 ? (
          <div className="mt-4 rounded-card border border-dashed border-line bg-panel/40 px-6 py-12 text-center">
            <p className="font-athletic text-xl font-black uppercase tracking-tight text-chalk">
              No takes yet
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-chalk-3">
              Be the first take on the board today. Set the score everyone else has
              to beat.
            </p>
          </div>
        ) : (
          <div className="bezel mt-4 overflow-hidden">
            {/* A real table. This is rank / name / score, which is tabular data,
                and a grid of divs gives a screen reader no column association at
                all: every cell was read as a loose string with no header. */}
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">
                Today&apos;s board, ranked by score
              </caption>
              <thead>
                <tr className="border-b border-line">
                  <th
                    scope="col"
                    className="w-14 px-5 py-3 text-left font-mono text-[10px] font-bold tracking-[0.25em] text-chalk-3"
                  >
                    #
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-3 text-left font-mono text-[10px] font-bold tracking-[0.25em] text-chalk-3"
                  >
                    BALLER
                  </th>
                  <th
                    scope="col"
                    className="w-24 px-5 py-3 text-right font-mono text-[10px] font-bold tracking-[0.25em] text-chalk-3"
                  >
                    SCORE
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {board.map((r, i) => {
                  const isMe = r.user_id === myUserId
                  return (
                    <tr
                      key={r.user_id}
                      aria-current={isMe ? 'true' : undefined}
                      className={isMe ? 'bg-steel/25' : undefined}
                    >
                      <td
                        className={`px-5 py-3 font-athletic text-xl font-black tabular-nums ${
                          i < 3 ? 'text-blaze-bright' : 'text-chalk-3'
                        }`}
                      >
                        {i + 1}
                      </td>
                      <td className="truncate px-2 py-3">
                        <span className={isMe ? 'font-semibold text-chalk' : 'text-chalk-2'}>
                          {r.username}
                        </span>
                        {isMe && (
                          <span className="ml-2 font-mono text-[10px] font-bold tracking-widest text-blaze-bright">
                            YOU
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-athletic text-xl font-black tabular-nums text-chalk">
                        {r.score}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Link
        href="/dashboard/leaderboard"
        className="inline-flex min-h-[44px] items-center text-sm font-semibold text-blaze-bright hover:text-chalk"
      >
        See the career Board
      </Link>
    </div>
  )
}
