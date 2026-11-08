'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import PageHeader from '@/components/page-header'
import { RadioCards } from '@/components/ui/radio-cards'
import { ArrowsLeftRight, Coin } from '@phosphor-icons/react/dist/ssr'
import {
  DIFFICULTIES,
  DIFFICULTY_META,
  DIFFICULTY_NAME,
  TURN_LENGTH_OPTIONS,
  HANDOFF_BREAK_SECONDS,
  SECTION_BREAK_SECONDS,
  H2H_WIN_POINTS,
  LOSS_PENALTY,
  applyFounding,
  pointsDelta,
  randomTopic,
  assignSide,
  debateOpenState,
  type Difficulty,
  type BoardTopic,
  type HumanSpeaker,
} from '@/lib/debate'
import { EVENTS, capture } from '@/lib/analytics'
import { canDebate, isOutOfTickets, spendable, timeUntil, type Wallet } from '@/lib/tickets'
import { announceOutOfTickets } from '@/lib/pack-offer'
import OutOfTickets from '@/components/out-of-tickets'
import { fetchWallet } from '@/components/ticket-meter'

// Starting a debate (UX audit C, 2026-10-10).
//
// It was four numbered steps and eleven full cards, about four and a half
// phone screens, and every visit started from the same defaults, so a regular
// answered the same four questions every time and a first-timer had no basis
// for any of them. Now it is one card, "Your setup", carried over from the last
// debate (localStorage, so it survives the tab but not a new device), with
// Change opening the same choices in place as compact switches. Start is always
// on screen.
//
// Everything that made the old form safe is kept: random topics stay sealed
// until tip-off (founder call 2026-08-11), the mic is checked BEFORE the insert
// that spends the ticket, and the out-of-tickets card sits above the form
// instead of replacing it.
//
// Two topics can arrive by id, never as text (a free-text topic is the Pro
// custom-topic perk): ?daily=<prompt id> debates today's Daily question
// against the AI (UX audit H1), and ?from=<shared debate id> takes a shared
// verdict's topic (G2). Both fix the topic and ask only for a side.

type MatchupType = 'random' | 'custom' | 'fixed'
// 'human' = same-device exhibition, 'online' = ranked lobby over live video.
type Opponent = 'ai' | 'human' | 'online'

type SavedSetup = {
  opponent: Opponent
  difficulty: Difficulty
  mode: 'text' | 'speech'
  turnSeconds: number
  isListed: boolean
}

const SETUP_KEY = 'heated:lastSetup'

function readSavedSetup(): SavedSetup | null {
  try {
    const raw = localStorage.getItem(SETUP_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<SavedSetup>
    if (!s.opponent || !s.difficulty || !DIFFICULTIES.includes(s.difficulty)) return null
    return {
      opponent: s.opponent === 'human' || s.opponent === 'online' ? s.opponent : 'ai',
      difficulty: s.difficulty,
      mode: s.mode === 'speech' ? 'speech' : 'text',
      turnSeconds: TURN_LENGTH_OPTIONS.includes(s.turnSeconds as (typeof TURN_LENGTH_OPTIONS)[number])
        ? (s.turnSeconds as number)
        : 120,
      isListed: s.isListed !== false,
    }
  } catch {
    return null
  }
}

function saveSetup(s: SavedSetup) {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify(s))
  } catch {
    // A convenience, not state anyone depends on.
  }
}

// H2H reuses the difficulty scale purely as topic nicheness (there's no AI
// persona and no payout in an exhibition), so it gets its own blurbs.
const DEPTH_BLURBS: Record<Difficulty, string> = {
  rookie: 'Mainstream matchups everyone has a take on.',
  starter: 'Well-known topics with some teeth.',
  all_star: 'For people who actually watch League Pass.',
  hall_of_famer: 'Deep cuts and box-score archaeology.',
}

const TURN_LENGTH_COPY: Record<number, { label: string; desc: string }> = {
  60: { label: '1:00', desc: 'Quick hits. Say it and sit down.' },
  90: { label: '1:30', desc: 'Room to build a case.' },
  120: { label: '2:00', desc: 'The full cook. Same as vs the AI.' },
}

const OPPONENT_NAME: Record<Opponent, string> = {
  ai: 'The AI',
  human: 'A friend, on this phone',
  online: 'Online, ranked',
}

const fieldClass =
  'w-full rounded-card border border-line-strong bg-panel px-4 py-3.5 text-chalk placeholder:text-chalk-3 focus:border-blaze/60'

function SetupRow({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-3 py-3.5 [&+&]:border-t [&+&]:border-line">
      <dt className="text-[13px] text-chalk-3">{k}</dt>
      <dd>
        <span className="font-semibold text-chalk">{v}</span>
        {sub && <span className="mt-0.5 block text-[13px] leading-snug text-chalk-3">{sub}</span>}
      </dd>
    </div>
  )
}

// useSearchParams needs a Suspense boundary at the page level.
export default function NewDebatePage() {
  return (
    <Suspense fallback={null}>
      <NewDebateInner />
    </Suspense>
  )
}

function NewDebateInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Entry points that already know the opponent (the live board's "open a
  // lobby") pass ?opponent=; the opponent switch is then hidden.
  const lockedOpponentParam = searchParams.get('opponent')
  const lockedOpponent: Opponent | null =
    lockedOpponentParam === 'online'
      ? 'online'
      : lockedOpponentParam === 'human'
        ? 'human'
        : lockedOpponentParam === 'ai'
          ? 'ai'
          : null
  // A debate that aged out of its 24-hour resume window, run again from the top.
  const rerunId = searchParams.get('rerun')
  // A topic fixed by id: today's Daily question, or a shared verdict's topic.
  const dailyId = searchParams.get('daily')
  const fromId = searchParams.get('from')
  const fixedSource: 'daily' | 'shared' | null = dailyId ? 'daily' : fromId ? 'shared' : null

  const [opponent, setOpponent] = useState<Opponent>(fixedSource ? 'ai' : (lockedOpponent ?? 'ai'))
  const [difficulty, setDifficulty] = useState<Difficulty>('starter')
  const [matchupType, setMatchupType] = useState<MatchupType>(fixedSource ? 'fixed' : 'random')
  // Random matchup: topic + the host's assigned side, generated in the
  // background and SEALED until the arena. Null until the first roll lands.
  const [matchup, setMatchup] = useState<{ topic: BoardTopic; side: string } | null>(null)
  const [matchupLoading, setMatchupLoading] = useState(true)
  const [customTopic, setCustomTopic] = useState('')
  const [customSide, setCustomSide] = useState('')
  const [customGuestSide, setCustomGuestSide] = useState('')
  // Fixed topic (daily / shared): the topic, plus up to two named stances.
  const [fixed, setFixed] = useState<{ topic: string; stances: string[]; note: string } | null>(null)
  const [fixedError, setFixedError] = useState(false)
  const [fixedSide, setFixedSide] = useState('')
  const [guestName, setGuestName] = useState('')
  const [turnSeconds, setTurnSeconds] = useState<number>(120)
  const [isListed, setIsListed] = useState(true)
  const [mode, setMode] = useState<'text' | 'speech'>('text')
  const [username, setUsername] = useState<string | null>(null)
  const [isPro, setIsPro] = useState(false)
  const [isFounding, setIsFounding] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [capReached, setCapReached] = useState(false)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [editing, setEditing] = useState(false)
  // 'saved' = carried over from the last debate; 'first' = never played, so
  // these are the defaults we picked; null = still deciding.
  const [setupSource, setSetupSource] = useState<'saved' | 'first' | null>(null)

  // Guards against stale responses when difficulty is toggled quickly.
  const reqIdRef = useRef(0)

  // The error slot can be far from the fixed Start bar, so bring it into view.
  const errorRef = useRef<HTMLParagraphElement | null>(null)
  useEffect(() => {
    if (!error) return
    errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])

  // Roll a fresh random matchup: AI-generated topic (nicheness scales with
  // difficulty), falling back to the curated board if the API call fails, then
  // a side assignment (difficulty-weighted vs the AI, fair coin vs a friend).
  const rollMatchup = async (diff: Difficulty, opp: Opponent) => {
    const myReq = ++reqIdRef.current
    setMatchupLoading(true)
    let topicObj: BoardTopic
    try {
      const res = await fetch('/api/debate/topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty: diff }),
      })
      if (!res.ok) throw new Error(`topic ${res.status}`)
      const data = await res.json()
      if (!data?.topic || !data?.easySide || !data?.hardSide) throw new Error('bad topic')
      topicObj = { topic: data.topic, easySide: data.easySide, hardSide: data.hardSide }
    } catch {
      topicObj = randomTopic() // curated fallback keeps the app working offline / on error
    }
    if (myReq !== reqIdRef.current) return // a newer roll superseded this one
    const side =
      opp === 'human'
        ? Math.random() < 0.5
          ? topicObj.easySide
          : topicObj.hardSide
        : assignSide(topicObj, diff)
    setMatchup({ topic: topicObj, side })
    setMatchupLoading(false)
  }

  // A Daily or shared topic that cannot be read (the verdict was taken down,
  // the link is mangled): say so once, and carry on as a normal random debate
  // rather than leaving a setup with no topic in it.
  const fallBackToRandom = () => {
    setFixedError(true)
    setMatchupType('random')
    void rollMatchup('starter', 'ai')
  }

  useEffect(() => {
    // Mount-only. Restores the last setup (localStorage is browser-only, so it
    // cannot be the initial state without a hydration mismatch), rolls the
    // sealed matchup at that difficulty, then reads the profile and wallet.
    // ?rerun= and the fixed-topic entries skip the roll.
    const saved = readSavedSetup()
    let diff: Difficulty = 'starter'
    let opp: Opponent = lockedOpponent ?? 'ai'
    /* eslint-disable react-hooks/set-state-in-effect */
    if (saved && !rerunId && !fixedSource) {
      diff = saved.difficulty
      if (!lockedOpponent) opp = saved.opponent
      setDifficulty(saved.difficulty)
      setOpponent(opp)
      setMode(saved.mode)
      setTurnSeconds(saved.turnSeconds)
      setIsListed(saved.isListed)
      setSetupSource('saved')
    }
    if (!rerunId && !fixedSource && opp !== 'online') void rollMatchup(diff, opp)
    /* eslint-enable react-hooks/set-state-in-effect */

    void (async () => {
      const supabase = supabaseBrowser()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [{ data: prof }, { count: played }] = await Promise.all([
        supabase.from('profiles').select('username, is_pro, is_founding').eq('id', user.id).single(),
        supabase
          .from('debates')
          .select('id', { count: 'exact', head: true })
          .or(`user_id.eq.${user.id},opponent_user_id.eq.${user.id}`),
      ])
      if (prof?.username) setUsername(prof.username)
      setIsPro(Boolean(prof?.is_pro))
      setIsFounding(Boolean(prof?.is_founding))
      if (!saved) setSetupSource((played ?? 0) === 0 ? 'first' : 'saved')
      setWallet(await fetchWallet())

      // Today's Daily question, read by id from daily_prompts (readable by any
      // signed-in user). 'sides' prompts name the two stances.
      if (dailyId) {
        const { data: p } = await supabase
          .from('daily_prompts')
          .select('topic, stance_a, stance_b')
          .eq('id', dailyId)
          .maybeSingle()
        if (!p) return fallBackToRandom()
        const stances = [p.stance_a, p.stance_b].filter((s): s is string => Boolean(s))
        setFixed({ topic: p.topic, stances, note: "Today's Daily question" })
        if (stances[0]) setFixedSide(stances[0])
        return
      }

      // A shared verdict's topic, through the public share read.
      if (fromId) {
        const res = await fetch(`/api/debate/${encodeURIComponent(fromId)}/topic`).catch(() => null)
        const data = res?.ok ? await res.json() : null
        if (!data?.topic) return fallBackToRandom()
        setFixed({
          topic: data.topic,
          stances: [],
          note: data.side ? `${data.by} argued ${data.side}` : `From ${data.by}'s verdict`,
        })
        return
      }

      // The topic is read from the DEBATE ROW, never from the query string:
      // a ?topic= param would be a Pro custom-topic gate bypass. RLS only
      // returns debates this user was actually in.
      if (!rerunId) return
      const { data: prev } = await supabase
        .from('debates')
        .select('topic_text, user_side, difficulty, mode, opponent, versus, status, updated_at')
        .eq('id', rerunId)
        .maybeSingle()
      if (!prev) {
        void rollMatchup('starter', 'ai')
        return
      }
      // Only a debate that is genuinely closed can be re-run; otherwise a
      // hand-typed ?rerun= could hold two tickets against one matchup.
      if (debateOpenState(prev.status, prev.updated_at, Date.now()) !== 'expired') {
        router.replace(`/dashboard/debate/${rerunId}`)
        return
      }
      setDifficulty(prev.difficulty as Difficulty)
      setOpponent(prev.opponent === 'human' ? 'human' : 'ai')
      setMode(prev.mode === 'speech' ? 'speech' : 'text')
      // Kept 'random' rather than 'custom': custom is the Pro path, and this is
      // a replay of a topic the user was already handed.
      const prevGuestSide = (prev.versus as { guest_side?: string } | null)?.guest_side ?? ''
      const prevSide = (prev.user_side as string) ?? ''
      setMatchupType('random')
      setMatchup({
        topic: { topic: prev.topic_text as string, easySide: prevSide, hardSide: prevGuestSide },
        side: prevSide,
      })
      setMatchupLoading(false)
    })()
    // The params come from the URL and do not change without a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Difficulty drives the payout AND (for random matchups) both the topic
  // nicheness and how tough a side you get handed, so re-roll on change.
  // Online random matchups are generated at accept, so there is nothing to roll.
  const chooseDifficulty = (d: Difficulty) => {
    setDifficulty(d)
    if (matchupType === 'random' && opponent !== 'online' && !rerunId) void rollMatchup(d, opponent)
  }

  // Switching opponent changes how random sides are assigned, so re-roll.
  const chooseOpponent = (o: Opponent) => {
    setOpponent(o)
    if (matchupType === 'random' && o !== 'online' && !rerunId) void rollMatchup(difficulty, o)
  }

  const swapCustomSides = () => {
    setCustomSide(customGuestSide)
    setCustomGuestSide(customSide)
  }
  const flipCustomSides = () => {
    if (Math.random() < 0.5) swapCustomSides()
  }

  const hostLabel = username ?? 'You'
  const guestLabel = opponent === 'online' ? 'Your opponent' : guestName.trim() || 'Your friend'
  const guestSideForRandom = matchup
    ? matchup.side === matchup.topic.easySide
      ? matchup.topic.hardSide
      : matchup.topic.easySide
    : ''

  const remember = () =>
    saveSetup({ opponent, difficulty, mode, turnSeconds, isListed })

  // Online: create a LOBBY, not a debate. The match forms when the host
  // accepts a challenger.
  const createLobby = async () => {
    if (matchupType === 'custom') {
      if (!customTopic.trim()) return setError('Write your topic.')
      if (!customSide.trim()) return setError('Fill in the side you want to argue.')
      if (!customGuestSide.trim()) return setError("Fill in your opponent's side.")
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/lobby/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicSource: matchupType === 'custom' ? 'custom' : 'random',
          topicText: customTopic.trim().slice(0, 200),
          hostSide: customSide.trim().slice(0, 120),
          guestSide: customGuestSide.trim().slice(0, 120),
          difficulty,
          turnSeconds,
          isListed,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 403 && data?.capReached) {
        capture(EVENTS.CAP_HIT, { surface: 'lobby_create', mode: 'online' })
        announceOutOfTickets('lobby_create')
        setCapReached(true)
        setLoading(false)
        return
      }
      if (res.status === 409 && data?.existingId) {
        router.push(`/dashboard/lobby/${data.existingId}`)
        return
      }
      if (!res.ok) {
        setError(data?.error ?? 'Could not open the lobby. Try again.')
        setLoading(false)
        return
      }
      remember()
      router.push(`/dashboard/lobby/${data.id}`)
    } catch {
      setError('Could not reach the server. Try again.')
      setLoading(false)
    }
  }

  const startDebate = async () => {
    if (opponent === 'online') {
      void createLobby()
      return
    }
    if (matchupType === 'random' && (!matchup || matchupLoading)) {
      setError('Hang on, still building your matchup.')
      return
    }
    if (matchupType === 'fixed' && !fixed) {
      setError('Hang on, still loading the topic.')
      return
    }
    const topicText =
      matchupType === 'random'
        ? matchup!.topic.topic
        : matchupType === 'fixed'
          ? fixed!.topic.slice(0, 200)
          : customTopic.trim().slice(0, 200)
    const hostSide =
      matchupType === 'random'
        ? matchup!.side
        : matchupType === 'fixed'
          ? fixedSide.trim().slice(0, 120)
          : customSide.trim().slice(0, 120)
    const guestSide =
      matchupType === 'random' ? guestSideForRandom : customGuestSide.trim().slice(0, 120)

    if (matchupType === 'fixed' && !hostSide) {
      setError('Pick the side you want to argue.')
      return
    }
    if (matchupType === 'custom') {
      if (!topicText) return setError('Write your topic.')
      if (!hostSide) {
        return setError(opponent === 'human' ? 'Fill in the first side.' : 'Pick the side you want to argue.')
      }
      if (opponent === 'human' && !guestSide) return setError('Fill in the second side.')
    }

    setLoading(true)
    setError('')

    const supabase = supabaseBrowser()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      window.location.href = '/auth/login?next=/dashboard/debate/new'
      return
    }

    // Mic pre-check BEFORE the insert, because the insert is where the ticket
    // is spent and a speech debate without a mic is a dead end that has
    // already been paid for. Same-device H2H is always speech.
    const wantsMic = opponent === 'human' || mode === 'speech'
    if (wantsMic && typeof navigator !== 'undefined' && navigator.mediaDevices) {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
        probe.getTracks().forEach((t) => t.stop())
      } catch (err) {
        const name = err instanceof DOMException ? err.name : ''
        setError(
          name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'No microphone found. Plug one in, or switch the format to Text.'
            : 'Your browser is blocking the mic. Allow it in site settings, or switch the format to Text.'
        )
        setLoading(false)
        return
      }
    }

    // Direct insert: RLS scopes it to this user, and the DB ticket trigger is
    // the enforcement layer (1 ticket, every mode).
    const first: HumanSpeaker = Math.random() < 0.5 ? 'host' : 'guest'
    const { data, error: insertError } = await supabase
      .from('debates')
      .insert({
        user_id: user.id,
        topic_text: topicText,
        user_side: hostSide,
        mode: opponent === 'human' ? 'speech' : mode,
        difficulty,
        is_random: matchupType === 'random',
        opponent,
        status: 'arguing',
        ...(opponent === 'human'
          ? {
              versus: {
                guest_name: guestName.trim().slice(0, 24) || 'The Challenger',
                guest_side: guestSide,
                turn_seconds: TURN_LENGTH_OPTIONS.includes(
                  turnSeconds as (typeof TURN_LENGTH_OPTIONS)[number]
                )
                  ? turnSeconds
                  : 120,
                first,
              },
            }
          : {}),
      })
      .select('id')
      .single()

    if (insertError) {
      if (isOutOfTickets(insertError.message)) {
        capture(EVENTS.CAP_HIT, { surface: 'new_debate', mode: opponent })
        announceOutOfTickets('new_debate')
        void fetchWallet().then(setWallet)
        setCapReached(true)
      } else {
        setError('Could not start the debate. Try again.')
        console.error(insertError)
      }
      setLoading(false)
      return
    }

    capture(EVENTS.DEBATE_STARTED, {
      mode: opponent === 'human' ? 'same_device' : 'ai',
      format: opponent === 'human' ? 'speech' : mode,
      difficulty,
      matchup: matchupType === 'fixed' ? fixedSource : matchupType,
    })
    if (!fixedSource && !rerunId) remember()
    router.push(`/dashboard/debate/${data.id}`)
  }

  const isHuman = opponent === 'human'
  const isOnline = opponent === 'online'
  // Pack tickets unlock the Pro perks too, same as public.is_effective_pro().
  const effectivePro = isPro || (wallet?.purchased ?? 0) > 0
  const walletEmpty = wallet !== null && !canDebate(wallet)
  const blocked = capReached || walletEmpty
  const tickets = wallet ? spendable(wallet) : null
  const winPoints = applyFounding(pointsDelta('win', difficulty, matchupType === 'random'), isFounding)

  const stakeLine = isOnline
    ? `Ranked: the winner takes +${applyFounding(H2H_WIN_POINTS, isFounding)}, the loser loses ${LOSS_PENALTY}.`
    : isHuman
      ? 'An exhibition: a full verdict, and no points either way.'
      : `A win pays +${winPoints}. A loss costs ${LOSS_PENALTY}. Three rounds, about ten minutes.`

  const ticketLine = isOnline
    ? "Opening a lobby is free. The ticket goes when the match starts."
    : tickets === null
      ? 'Uses 1 ticket.'
      : tickets === 1
        ? `Uses your last ticket.${wallet?.nextTicketAt ? ` The next free one lands ${timeUntil(wallet.nextTicketAt)}.` : ''}`
        : `Uses 1 of your ${tickets} tickets.`

  const topicSummary = (() => {
    if (matchupType === 'fixed') {
      return { v: fixed ? fixed.topic : 'Loading…', sub: fixed?.note }
    }
    if (rerunId && matchup) return { v: matchup.topic.topic, sub: 'The same topic, from the top.' }
    if (matchupType === 'custom') return { v: 'Your own', sub: 'Type it below.' }
    return {
      v: 'Random',
      sub: isOnline
        ? 'Generated at tip-off, sides flipped. Nobody gets to prep.'
        : isHuman
          ? 'Revealed at tip-off, and a coin flip hands out the sides.'
          : 'You read it when the debate starts, same as a real argument.',
    }
  })()

  const formatSummary = isHuman || isOnline
    ? { k: 'Clock', v: `${TURN_LENGTH_COPY[turnSeconds]?.label ?? '2:00'} a turn`, sub: isOnline ? 'Live over video, all speech.' : 'All speech, one phone.' }
    : mode === 'speech'
      ? { k: 'Format', v: 'Speech', sub: '2 minutes on the mic each round.' }
      : { k: 'Format', v: 'Text', sub: '3 minutes a round to type your case.' }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow={
          matchupType === 'fixed'
            ? fixedSource === 'daily'
              ? 'NEW DEBATE · THE DAILY QUESTION'
              : 'NEW DEBATE · TAKE THE OTHER SIDE'
            : 'NEW DEBATE'
        }
        title={<>Pick your fight.</>}
      />

      {/* The cap card sits ABOVE the form, it does not replace it: swapping it
          in unmounted every field the user had filled in, with no way back. */}
      {blocked && (
        <div className="mt-8">
          <OutOfTickets wallet={wallet} surface="new_debate" />
        </div>
      )}

      <div className="reveal r2 mt-8 space-y-6">
        {/* ── Your setup ───────────────────────────────────────────── */}
        <section aria-labelledby="setup-heading" className="bezel p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="setup-heading" className="font-mono text-[10.5px] font-bold tracking-[0.25em] text-chalk-3">
                YOUR SETUP
              </h2>
              <p className="mt-1 text-[13px] text-chalk-3">
                {matchupType === 'fixed'
                  ? 'The topic is set. Pick your side below.'
                  : rerunId
                    ? 'Running it again.'
                    : setupSource === 'first'
                      ? 'We picked these for your first one.'
                      : setupSource === 'saved'
                        ? 'Same as your last debate.'
                        : ' '}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-expanded={editing}
              aria-controls="setup-choices"
              onClick={() => setEditing((e) => !e)}
            >
              {editing ? 'Done' : 'Change'}
            </Button>
          </div>

          {editing ? (
            <div id="setup-choices" className="mt-5 space-y-6">
              {!lockedOpponent && matchupType !== 'fixed' && (
                <RadioCards<Opponent>
                  compact
                  legend="Who's on the other side?"
                  value={opponent}
                  onChange={chooseOpponent}
                  options={[
                    { value: 'ai', title: 'THE AI', label: 'The AI', desc: 'Solo. Points on the line, verdict at the buzzer.' },
                    { value: 'human', title: 'SAME DEVICE', label: 'Same phone', desc: 'Two people, one phone, all speech. A full verdict and zero points.' },
                    { value: 'online', title: 'ONLINE', label: 'Online', desc: `Live video against a real opponent. Ranked: winner +${H2H_WIN_POINTS}, loser -${LOSS_PENALTY}.` },
                  ]}
                />
              )}
              <RadioCards<Difficulty>
                compact
                legend={isHuman || isOnline ? 'How deep do the topics cut?' : 'How good is the AI?'}
                value={difficulty}
                onChange={chooseDifficulty}
                options={DIFFICULTIES.map((d) => ({
                  value: d,
                  title: DIFFICULTY_META[d].label,
                  // A non-breaking hyphen, so a narrow switch cannot split
                  // "All-Star" across two lines.
                  label: d === 'hall_of_famer' ? 'HoF' : DIFFICULTY_NAME[d].replace('-', '‑'),
                  desc:
                    isHuman || isOnline
                      ? DEPTH_BLURBS[d]
                      : `${DIFFICULTY_META[d].blurb} ${DIFFICULTY_META[d].multiplier}x points${
                          matchupType === 'random' ? ', and on a random topic you get the tougher side more often.' : '.'
                        }`,
                }))}
              />
              {matchupType !== 'fixed' && !rerunId && (
                effectivePro ? (
                  <RadioCards<'random' | 'custom'>
                    compact
                    legend="Topic"
                    value={matchupType === 'custom' ? 'custom' : 'random'}
                    onChange={setMatchupType}
                    options={[
                      { value: 'random', title: 'RANDOM', label: 'Random', desc: 'Sealed until tip-off.' },
                      { value: 'custom', title: 'BRING YOUR OWN', label: 'Your own', desc: 'Type the beef you already have.' },
                    ]}
                  />
                ) : (
                  // A radiogroup containing a link would be a lie to a screen
                  // reader, so free accounts get a statement plus an honest upsell.
                  <div>
                    <p className="text-sm font-semibold text-chalk">Topic</p>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-chalk-3">
                      Random, sealed until tip-off.{' '}
                      <Link
                        href="/upgrade"
                        onClick={() =>
                          capture(EVENTS.UPGRADE_CLICKED, { surface: 'new_debate', intent: 'custom_topic' })
                        }
                        className="inline-flex min-h-[44px] items-center gap-1.5 align-middle font-semibold text-blaze-bright hover:underline"
                      >
                        Bring your own topic
                        <span className="rounded-full bg-blaze px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest text-white">
                          PRO
                        </span>
                      </Link>
                    </p>
                  </div>
                )
              )}
              {isHuman || isOnline ? (
                <RadioCards
                  compact
                  legend="Turn clock"
                  value={String(turnSeconds)}
                  onChange={(v) => setTurnSeconds(Number(v))}
                  options={TURN_LENGTH_OPTIONS.map((sec) => ({
                    value: String(sec),
                    title: TURN_LENGTH_COPY[sec].label,
                    desc: TURN_LENGTH_COPY[sec].desc,
                  }))}
                  hint={`Contention, rebuttal, summary: you each get the mic every round. ${HANDOFF_BREAK_SECONDS}s hand-offs, ${SECTION_BREAK_SECONDS}s between sections, and a coin flip decides who leads.`}
                />
              ) : (
                <RadioCards<'text' | 'speech'>
                  compact
                  legend="Format"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'text', title: 'TEXT', label: 'Text', desc: '3 minutes a round to type your case. Whatever is typed sends at 0:00.' },
                    { value: 'speech', title: 'SPEECH', label: 'Speech', desc: '2 minutes on the mic each round.' },
                  ]}
                />
              )}
              {isOnline && (
                <RadioCards<'listed' | 'unlisted'>
                  compact
                  legend="Who can see the lobby?"
                  value={isListed ? 'listed' : 'unlisted'}
                  onChange={(v) => setIsListed(v === 'listed')}
                  options={[
                    { value: 'listed', title: 'LISTED', label: 'Live board', desc: 'Anyone can find it and ask to join. You still pick who gets the shot.' },
                    { value: 'unlisted', title: 'UNLISTED', label: 'Code only', desc: 'Send the code to the one person who needs humbling.' },
                  ]}
                />
              )}
            </div>
          ) : (
            <dl id="setup-choices" className="mt-3">
              <SetupRow k="Opponent" v={OPPONENT_NAME[opponent]} />
              <SetupRow
                k={isHuman || isOnline ? 'Topic depth' : 'Difficulty'}
                v={DIFFICULTY_NAME[difficulty]}
                sub={
                  isHuman || isOnline
                    ? DEPTH_BLURBS[difficulty]
                    : `${DIFFICULTY_META[difficulty].blurb} ${DIFFICULTY_META[difficulty].multiplier}x points.`
                }
              />
              <SetupRow k="Topic" v={topicSummary.v} sub={topicSummary.sub} />
              <SetupRow k={formatSummary.k} v={formatSummary.v} sub={formatSummary.sub} />
              {isOnline && (
                <SetupRow
                  k="Lobby"
                  v={isListed ? 'On the live board' : 'Code only'}
                  sub={isListed ? 'Anyone can ask to join. You pick.' : 'Only people you send the code to.'}
                />
              )}
            </dl>
          )}
        </section>

        <p className="px-1 text-sm leading-relaxed text-chalk-3">{stakeLine}</p>

        {/* ── Fixed topic: pick a side ─────────────────────────────── */}
        {matchupType === 'fixed' && fixed && (
          <section className="bezel space-y-3 p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-chalk">Your side</h2>
            {fixed.stances.length >= 2 ? (
              <RadioCards<string>
                compact
                legend={<span className="sr-only">Your side</span>}
                value={fixedSide}
                onChange={setFixedSide}
                options={fixed.stances.map((s) => ({ value: s, title: s, label: s }))}
                hint="The AI argues the other one."
              />
            ) : (
              <>
                <label htmlFor="fixed-side" className="sr-only">
                  The side you want to argue
                </label>
                <input
                  id="fixed-side"
                  type="text"
                  maxLength={120}
                  placeholder="e.g. Klay mattered more"
                  value={fixedSide}
                  onChange={(e) => setFixedSide(e.target.value)}
                  className={fieldClass}
                />
                <p className="text-[13px] text-chalk-3">The AI argues the opposite of whatever you pick.</p>
              </>
            )}
          </section>
        )}
        {fixedError && (
          <p role="status" className="rounded-card border border-line-strong px-4 py-3 text-sm text-chalk-2">
            That topic isn&apos;t available any more, so this is a random matchup instead.
          </p>
        )}

        {/* ── Your own topic ───────────────────────────────────────── */}
        {matchupType === 'custom' && (
          <section className="bezel space-y-4 p-5 sm:p-6">
            <div>
              <label htmlFor="custom-topic" className="mb-2 block text-sm font-semibold text-chalk">
                The topic
              </label>
              <input
                id="custom-topic"
                type="text"
                placeholder="e.g. Was the 2004 Pistons title a fluke?"
                maxLength={200}
                value={customTopic}
                onChange={(e) => setCustomTopic(e.target.value)}
                className={fieldClass}
              />
            </div>
            {isHuman || isOnline ? (
              <>
                <div>
                  <label htmlFor="host-side" className="mb-2 block text-sm font-semibold text-chalk">
                    {hostLabel} argues
                  </label>
                  <input
                    id="host-side"
                    type="text"
                    placeholder="e.g. It was earned"
                    maxLength={120}
                    value={customSide}
                    onChange={(e) => setCustomSide(e.target.value)}
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label htmlFor="guest-side" className="mb-2 block text-sm font-semibold text-chalk">
                    {guestLabel} argues
                  </label>
                  <input
                    id="guest-side"
                    type="text"
                    placeholder="e.g. Total fluke"
                    maxLength={120}
                    value={customGuestSide}
                    onChange={(e) => setCustomGuestSide(e.target.value)}
                    className={fieldClass}
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="secondary" size="sm" onClick={swapCustomSides}>
                    <ArrowsLeftRight size={14} weight="bold" aria-hidden />
                    Swap sides
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={flipCustomSides}>
                    <Coin size={14} weight="fill" aria-hidden />
                    Flip for it
                  </Button>
                </div>
              </>
            ) : (
              <div>
                <label htmlFor="my-side" className="mb-2 block text-sm font-semibold text-chalk">
                  The side you want
                </label>
                <input
                  id="my-side"
                  type="text"
                  placeholder="e.g. It was earned"
                  maxLength={120}
                  value={customSide}
                  onChange={(e) => setCustomSide(e.target.value)}
                  className={fieldClass}
                />
                <p className="mt-2 text-[13px] text-chalk-3">The AI argues the opposite of whatever you pick.</p>
              </div>
            )}
          </section>
        )}

        {/* ── Who's debating (same phone) ──────────────────────────── */}
        {isHuman && (
          <section className="bezel p-5 sm:p-6">
            <label htmlFor="guest-name" className="block text-sm font-semibold text-chalk">
              Who are you playing?
            </label>
            <p className="mt-1 text-[13px] text-chalk-3">
              {hostLabel} is speaker one. Their name goes on the verdict card; blank means &quot;The
              Challenger&quot;.
            </p>
            <input
              id="guest-name"
              type="text"
              autoComplete="off"
              placeholder="Your friend's name"
              maxLength={24}
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              className={`${fieldClass} mt-3`}
            />
          </section>
        )}

        {error && (
          <p ref={errorRef} role="alert" className="rounded-card border border-blaze/50 px-4 py-3 text-sm text-chalk">
            {error}
          </p>
        )}
      </div>

      {/* ── Sticky action bar ─────────────────────────────────────────
          The exit is visible at every breakpoint and in every state,
          including out-of-tickets (this route has no tab bar). */}
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm">
        <div className="mx-auto max-w-2xl px-5 py-3 sm:px-6">
          {!blocked && <p className="mb-2 text-center text-[13px] text-chalk-3 sm:text-left">{ticketLine}</p>}
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/dashboard"
              className="inline-flex min-h-[44px] items-center text-sm font-semibold text-chalk-3 transition-colors hover:text-chalk"
            >
              {blocked ? 'Back to the Locker room' : 'Cancel'}
            </Link>
            {!blocked && (
              <Button
                type="button"
                size="lg"
                onClick={startDebate}
                disabled={loading || (matchupType === 'fixed' && !fixed)}
                aria-busy={loading}
                className="flex-1 sm:flex-none sm:px-12"
              >
                {loading ? 'SETTING UP…' : isOnline ? 'OPEN THE LOBBY' : 'START THE DEBATE'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
