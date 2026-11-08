// Shared debate domain types + constants (client and server safe: no secrets).

export const ROUND_ORDER = ['contention', 'rebuttal', 'summary'] as const
export type RoundName = (typeof ROUND_ORDER)[number]

// 'user'/'ai' = human-vs-AI debates. 'host'/'guest' = human-vs-human
// exhibitions (host = the signed-in account, guest = the named friend).
export type RoundEntry = {
  round: RoundName
  speaker: 'user' | 'ai' | 'host' | 'guest'
  text: string
}

export type Verdict = {
  user_score: number
  ai_score: number
  winner: 'user' | 'opponent' | 'none'
  note: string
  receipts: string[]
  /**
   * The Judge's Deep Dive: a per-section read of where the debate actually
   * turned. Pro-only in the UI, but generated on EVERY verdict regardless of
   * who is paying, for two reasons. It costs a few hundred output tokens on a
   * call that is already happening, and it means someone who upgrades can go
   * back and read the debates they already lost, which is most of the reason
   * to buy it. Absent on every verdict judged before 2026-08-10.
   */
  deep_dive?: DeepDiveEntry[]
  /**
   * Per-dimension scores behind `user_score` / `ai_score`, which are the mean of
   * the three. Present on every verdict judged from 2026-08-15. The judge is
   * asked for these three numbers and NEVER for the total, because a model that
   * reports both will cheerfully return a total that contradicts its own
   * breakdown, and the breakdown is the half with the reasoning behind it.
   */
  breakdown?: VerdictBreakdown
}

export type RubricScores = { facts: number; logic: number; delivery: number }

// Keyed the same way as user_score/ai_score: `user` is the account holder,
// `ai` is the AI opponent or the H2H guest.
export type VerdictBreakdown = { user: RubricScores; ai: RubricScores }

/**
 * One section of the Deep Dive. `swing` marks the single section that decided
 * the debate, which is the "exact moment you lost it" the pricing page sells.
 */
export type DeepDiveEntry = {
  round: RoundName
  verdict: string
  swing: boolean
}

// ── Shared judge rubric fragments ─────────────────────────────────
// Used verbatim by all three graders (H2H judge, vs-AI judge, daily grader) so
// the FACTS rule can't drift between them. The judge model has a training
// cutoff, so its memory of the CURRENT NBA season is stale and WRONG for recent
// events: rosters, which team a player is on now, trades/signings, this year's
// standings, and the most recent champion all move after the cutoff. The old
// rubric ("penalize invented stats hard", "only credit settled history") made
// the judge fact-check those against its own memory and punish debaters for
// TRUE, post-cutoff claims (real verdicts docked LeBron-to-the-76ers, the Knicks
// as defending champs, and Simons-to-the-76ers as "invented"). These fragments
// scope FACTS penalties to what is actually verifiable (the NBA.com career-stats
// grounding block, handled separately in the judge route) or internally
// impossible, and force the judge to take current/recent claims at face value.
export const JUDGE_FACTS_LINE =
  '1. FACTS: relevance and internal soundness of the basketball evidence. Do NOT grade whether a claim matches your own knowledge of the current league (see the recency rule below). Only penalize evidence that is impossible within the rules of basketball or that the debater contradicts within their own argument.'

export const JUDGE_RECENCY_RULE =
  "- You do NOT know the current NBA season. Rosters, which team a player is on, trades, signings, and the most recent champion all change after your training cutoff, so your memory of them is unreliable and probably out of date. You MUST treat every claim about a player's current team, a recent trade or signing, or who won the most recent title as TRUE. Never contradict such a claim and never call it invented, false, wrong, or impossible, no matter how sure you are that it is incorrect, because your confidence about current rosters is exactly the thing that is out of date. Judge these claims only on how well they support the argument. Disputed opinions and predictions are likewise legitimate arguments, not wrong facts. The ONLY facts you may penalize are ones impossible within the rules of basketball itself (for example one player scoring 150 points in a single game) or ones a debater contradicts within their own argument. Whenever a roster or championship claim conflicts with what you think you know, assume YOU are the one who is out of date."

// Shared 0-100 scale. Both graders import this so a 78 means the same thing on
// a daily take as it does in a debate, which matters because the two numbers sit
// next to each other on a profile.
//
// It exists because "do not be generous, 85+ is excellent" was the entire scale
// and the judge collapsed onto a handful of habitual numbers under it: across
// the first 17 real verdicts the human's score was 72 or 78 thirteen times.
export const JUDGE_SCORE_ANCHORS =
  'Anchors: 90+ = genuinely outstanding, a case you would struggle to beat. 80-89 = strong and well-evidenced, few soft spots. 70-79 = solid and competent with clear gaps. 60-69 = shows up but does not do the work. 40-59 = thin, generic, or barely engaged with the topic. Below 40 = near-empty, off-topic, or nothing argued at all.'

// The half of the grounding rule that is easy to forget and expensive to get
// wrong. The VERIFIED FACTS block is built from ESPN, which has no championship
// taxonomy at all, and its awards line is truncated to the top few honours. A
// grader that reads "no ring listed" as "no rings" would punish the single most
// cited fact in the sport, which is the same confident-wrong failure grounding
// exists to prevent, just pointed the other way.
export const GROUNDING_NOT_EXHAUSTIVE =
  'That block is NOT a complete record. It never contains championship or ring counts, it lists only the top few individual awards, and it covers only some of the players discussed. The ABSENCE of a fact from that block is not evidence that the fact is false. Never penalize a claim, and never call it unverified, merely because it does not appear there. For anything the block does not cover, follow the recency rule above instead of fact-checking from memory.'

// The reigning NBA champion, manually set (update once a year after the
// Finals). No free data source reliably exposed this as a single field when
// checked live (2026-07-25), and getting it wrong is worse than not stating
// it — same lesson as the roster bug — so a hand-set constant beats a fragile
// derivation. Empty means unset: the judge falls back to JUDGE_RECENCY_RULE
// (never contradicts EITHER side's champion claim) instead of asserting one.
export const REIGNING_NBA_CHAMPION = 'New York Knicks'

export function championGroundingLine(): string {
  if (!REIGNING_NBA_CHAMPION) return ''
  return `- VERIFIED: the reigning NBA champion is ${REIGNING_NBA_CHAMPION}. Treat this as settled fact for FACTS scoring: a claim naming a DIFFERENT team as the current champion is wrong, but a claim that agrees with this is correct, not unverifiable.`
}

// The AI OPPONENT's version of the same stale-knowledge problem, and it is the
// mirror image of the judge's. The judge had to stop PENALIZING true current
// claims; the opponent has to stop ASSERTING false ones. Same root cause (the
// model's roster knowledge is out of date), opposite failure: an opponent that
// says "LeBron on the Lakers" gets correctly rebutted by the human and then
// marked down by the now-grounded judge, so the AI loses to itself and the
// debate reads as broken. Deliberately does NOT forbid naming players or
// discussing the current league, which would gut the trash talk this app is
// built on: it forbids asserting the one class of fact the model cannot know.
export const DEBATER_RECENCY_RULE =
  "- Your knowledge of the CURRENT NBA season is out of date. Which team a player is on right now, this year's trades and signings, current standings, and the most recent champion have all changed since your training data. Unless a fact appears in the VERIFIED FACTS block, do NOT assert anything about a player's current team, a recent trade or signing, or who won the most recent title, and do not correct your opponent on those points. Argue from career-long accomplishments, head-to-head history, and settled basketball reasoning instead, which do not go stale. If your opponent states something about the current league that surprises you, treat it as true and argue around it rather than disputing it, because your memory is the unreliable part."

export const DEBATER_GROUNDING_RULE =
  '- The VERIFIED FACTS below were pulled from real data sources, not from your memory. Use them freely and treat them as correct even when they contradict what you remember. Quoting one of these numbers is the strongest move available to you. Never state a number that contradicts this block.'

// Same constant as championGroundingLine(), phrased for a debater rather than a
// scorer: the judge version talks about penalizing a wrong claim, which would be
// nonsense in a prompt whose job is to argue.
export function championDebaterLine(): string {
  if (!REIGNING_NBA_CHAMPION) return ''
  return `- The reigning NBA champion is the ${REIGNING_NBA_CHAMPION}. This one is verified, so you may state it confidently and should not contradict it.`
}

// ── Difficulty tiers ──────────────────────────────────────────────
// Harder AI = bigger payout. The multiplier scales both the win reward
// (base 100) and the loss reward (base 20), so playing up always pays more.
export const DIFFICULTIES = ['rookie', 'starter', 'all_star', 'hall_of_famer'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export const BASE_WIN_POINTS = 100
// A loss deducts points, but far less than a win awards — flat, not scaled, so
// playing a hard difficulty is low-downside / high-upside.
export const LOSS_PENALTY = 25
// Inappropriate language = automatic loss + a heavier deduction than a normal loss.
export const MODERATION_PENALTY = 100

// ── Graduated moderation (per-debate) ─────────────────────────────
// Two severity tiers come from lib/moderation.ts classify(): hate SLURS are
// zero tolerance (instant loss, MODERATION_PENALTY, no warnings), ordinary
// PROFANITY is graduated WITHIN a single debate by how many times this speaker
// has already been flagged (a warning first, then a live points deduction, then
// a loss). The redacted turn is itself a cost on every offense, warning
// included: you forfeit that turn's argument to the judge.
export const PROFANITY_STRIKE_PENALTY = 25

export type ModerationAction = 'warn' | 'deduct' | 'loss'

// Given how many times THIS speaker has already been flagged for profanity in
// this debate (= the count of their prior redacted turns), what happens on this
// offense? Slurs skip this ladder entirely and go straight to 'loss'.
export function profanityAction(priorOffenses: number): ModerationAction {
  if (priorOffenses <= 0) return 'warn'
  if (priorOffenses === 1) return 'deduct'
  return 'loss'
}

// Player-facing copy for a warn/deduct event (client-safe: no word lists here).
export function moderationNoticeText(action: ModerationAction, penalty: number): string {
  if (action === 'deduct') {
    return `Second warning. That turn was cut and ${penalty} points came off. One more and it is an automatic loss.`
  }
  return 'Watch your mouth. That turn was cut for language. Next one costs you points, the one after is a loss.'
}
// Random matchups (you don't get to pick topic or side) pay more than
// bring-your-own. Applied on WINS only.
export const RANDOM_BONUS = 1.25

// `hardSideChance` = probability that a random matchup hands you the contrarian,
// tougher-to-argue side (vs the easy/consensus side). Rises with difficulty, so
// "randomized based on difficulty": the topic is a random draw, the side is a
// difficulty-weighted coin.
export const DIFFICULTY_META: Record<
  Difficulty,
  { label: string; multiplier: number; blurb: string; persona: string; hardSideChance: number }
> = {
  rookie: {
    label: 'ROOKIE',
    multiplier: 1,
    blurb: 'The AI takes it easy. Good for warming up.',
    hardSideChance: 0.1,
    persona:
      "You are a casual fan who just likes arguing hoops. Talk like you are texting a buddy: easy, natural sentences and the obvious takes everyone already has. Your points stay surface-level and you do not always tie them together, and if the human clearly wins a point you can shrug and give it to them. Keep the trash talk light and friendly.",
  },
  starter: {
    label: 'STARTER',
    multiplier: 1.5,
    blurb: 'A real opponent who came to play.',
    hardSideChance: 0.35,
    persona:
      'You are a solid everyday debater who actually watches the game. Talk naturally and make a couple of genuine points that connect, and defend your side, but a sharper opponent can outwork you. Light, confident trash talk.',
  },
  all_star: {
    label: 'ALL-STAR',
    multiplier: 2,
    blurb: 'Sharp, relentless, brings receipts.',
    hardSideChance: 0.65,
    persona:
      'You are a sharp, well-versed debater. You still talk smooth and human, but your case is organized: each point flows into the next, backed by real specifics, and you go straight at the weak spots in the human argument. Confident and a little relentless.',
  },
  hall_of_famer: {
    label: 'HALL OF FAMER',
    multiplier: 3,
    blurb: 'Ruthless and airtight. Beat it and flex.',
    hardSideChance: 0.9,
    persona:
      'You are an elite debater at the top of the craft. Your argument sounds effortless and human but it is airtight: every point builds on the last into one seamless, persuasive case, you see counters coming and take them apart before they land, and you never give ground. Ruthless, never robotic. Only a genuinely excellent argument should beat you.',
  },
}

// Sentence-case names for prose ("An All-Star win pays +300"). The labels above
// are the all-caps mono versions for chips and eyebrows.
export const DIFFICULTY_NAME: Record<Difficulty, string> = {
  rookie: 'Rookie',
  starter: 'Starter',
  all_star: 'All-Star',
  hall_of_famer: 'Hall of Famer',
}

export type Outcome = 'win' | 'loss' | 'flagged'

// Points delta for a debate outcome (can be negative). Wins scale with
// difficulty (and get the random-matchup bonus); losses are a flat deduction;
// a moderation flag is a heavier flat deduction. Total profile points are
// floored at 0 by the caller.
export function pointsDelta(outcome: Outcome, difficulty: Difficulty, isRandom: boolean): number {
  if (outcome === 'win') {
    const bonus = isRandom ? RANDOM_BONUS : 1
    return Math.round(BASE_WIN_POINTS * DIFFICULTY_META[difficulty].multiplier * bonus)
  }
  if (outcome === 'flagged') return -MODERATION_PENALTY
  return -LOSS_PENALTY
}

// ── Founding members ──────────────────────────────────────────────
// The first 100 signups are permanent founding members (profiles.is_founding,
// set by the signup trigger). They get a permanent +20% boost on point GAINS so
// they progress faster. Applied AFTER pointsDelta / the daily bonus, on top of
// the difficulty and random multipliers.
export const FOUNDING_MULTIPLIER = 1.2

// Boost a positive point gain for a founding member. Losses/penalties (<= 0)
// pass through unchanged — founding helps you climb, it never deepens a loss.
export function applyFounding(points: number, isFounding: boolean): number {
  if (!isFounding || points <= 0) return points
  return Math.round(points * FOUNDING_MULTIPLIER)
}

// Hard limits: keep per-round cost bounded (mirrors pitchcoach's 20-min cap
// thinking — text length and speech seconds are the cost levers here).
export const MAX_ROUND_CHARS = 1500
export const MAX_ROUND_SECONDS = 120

// Text debate vs the AI: each of your turns is on a fixed clock. When it hits
// zero, whatever is in the box is submitted automatically (an empty box submits
// TEXT_TURN_FORFEIT, a round the judge scores near zero). Speech turns use their
// own recording cap (MAX_ROUND_SECONDS), so this only governs text mode.
export const TEXT_TURN_SECONDS = 180
export const TEXT_TURN_FORFEIT = '(Out of time. No argument submitted for this round.)'

// ── How long an unfinished debate stays open ──────────────────────
//
// Every clock in this app is client-side: the turn timers are setInterval
// inside a useEffect whose cleanup clears them on unmount, and nothing
// server-side advances a debate. So closing a tab mid-turn does not forfeit a
// debate, it FREEZES one at status 'arguing'. Before this window existed that
// was permanent: two rows sat in production for 47 and 58 days, each holding a
// ticket that would never produce a verdict.
//
// A frozen debate now stays resumable for 24 hours from its last activity,
// then goes in the books as unfinished. It can be run again on the same topic,
// from the top, for a fresh ticket.
export const DEBATE_RESUME_WINDOW_HOURS = 24

// Statuses a debate can sit in while it is still mid-play. 'complete' is
// terminal, 'error' and 'void' are already closed, and 'created' never had a
// turn in it.
const IN_PLAY_STATUSES = ['arguing', 'transcribing', 'judging'] as const

export type DebateOpenState = 'closed' | 'resumable' | 'expired'

/**
 * Whether an unfinished debate can still be picked up.
 *
 * Derived from (status, updatedAt) rather than stored, so there is no cron to
 * lag behind the boundary and no second source of truth to drift from it. The
 * row keeps its real status; what expires is the OFFER to resume.
 *
 * `nowMs` is a parameter rather than a Date.now() call so callers stay pure
 * under react-hooks/purity and so this is testable.
 */
export function debateOpenState(
  status: string,
  updatedAt: string,
  nowMs: number
): DebateOpenState {
  if (!(IN_PLAY_STATUSES as readonly string[]).includes(status)) return 'closed'
  const ageMs = nowMs - new Date(updatedAt).getTime()
  return ageMs > DEBATE_RESUME_WINDOW_HOURS * 3600_000 ? 'expired' : 'resumable'
}

/** ISO cutoff for "still resumable", for use as a query filter. */
export function debateResumeCutoffISO(nowMs: number): string {
  return new Date(nowMs - DEBATE_RESUME_WINDOW_HOURS * 3600_000).toISOString()
}

/** "3h 20m" / "48m" / "under a minute" of resume window left. */
export function resumeTimeLeft(updatedAt: string, nowMs: number): string {
  const msLeft =
    new Date(updatedAt).getTime() + DEBATE_RESUME_WINDOW_HOURS * 3600_000 - nowMs
  if (msLeft <= 0) return 'no time'
  const mins = Math.floor(msLeft / 60_000)
  if (mins < 1) return 'under a minute'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`
}

// ── Daily prompt ──────────────────────────────────────────────────
// One prompt a day, one graded take each, ranked on a daily leaderboard. The
// single top scorer is awarded these bonus points when the board closes (a
// marquee reward, on par with a Hall of Famer win). Client-safe constants.
export const DAILY_WIN_BONUS = 300
export const MAX_DAILY_CHARS = 1500
export const MAX_DAILY_SECONDS = 120

export const ROUND_COPY: Record<RoundName, { title: string; hint: string }> = {
  contention: {
    title: 'CONTENTION',
    hint: 'State your case. Strongest argument, best receipts.',
  },
  rebuttal: {
    title: 'REBUTTAL',
    hint: "Tear down what they actually said, not what you wish they said.",
  },
  summary: {
    title: 'SUMMARY',
    hint: 'Close it out. Land the one takeaway the judge remembers.',
  },
}

export type BoardTopic = { topic: string; easySide: string; hardSide: string }

// Curated matchup pool. `easySide` = the more defensible / consensus position,
// `hardSide` = the contrarian, tougher-to-argue position. A random matchup draws
// a topic at random and picks a side weighted by difficulty (see assignSide).
export const TOPIC_BOARD: BoardTopic[] = [
  {
    topic: 'LeBron vs MJ: who is the GOAT?',
    easySide: 'MJ is the GOAT',
    hardSide: 'LeBron is the GOAT over MJ',
  },
  {
    topic: 'Rings over stats?',
    easySide: 'Rings are what define an all-time great',
    hardSide: 'Stats matter more than rings for legacy',
  },
  {
    topic: "Wemby's ceiling: top 10 all time?",
    easySide: "It's too early to call Wemby a top-10-all-time ceiling",
    hardSide: "Wemby's ceiling is a top 10 player all time",
  },
  {
    topic: "'96 Bulls vs '17 Warriors",
    easySide: 'The 2017 Warriors would beat the 1996 Bulls',
    hardSide: 'The 1996 Bulls would beat the 2017 Warriors',
  },
  {
    topic: 'Kobe: top 5 all time?',
    easySide: 'Kobe is an all-time great but outside the top 5',
    hardSide: 'Kobe is a top 5 player all time',
  },
  {
    topic: 'Curry over Magic as the greatest point guard?',
    easySide: 'Magic is the greatest point guard ever',
    hardSide: 'Curry is the greatest point guard over Magic',
  },
  {
    topic: 'Iverson: overrated or underrated?',
    easySide: 'Iverson is overrated relative to his efficiency',
    hardSide: 'Iverson is underrated among the all-time greats',
  },
  {
    topic: 'Luka or Jokic to start a franchise?',
    easySide: 'Jokic is the pick to start a franchise',
    hardSide: 'Luka over Jokic to start a franchise',
  },
  {
    topic: "Shaq in today's league: still dominant?",
    easySide: 'Prime Shaq would still dominate today',
    hardSide: "Prime Shaq would struggle in today's spaced-out game",
  },
  {
    topic: "KD's legacy: top 15 all time?",
    easySide: 'KD is comfortably a top 15 player all time',
    hardSide: 'KD falls short of the top 15 all time',
  },
]

// Pick a random topic from the board.
export function randomTopic(): BoardTopic {
  return TOPIC_BOARD[Math.floor(Math.random() * TOPIC_BOARD.length)]
}

// Assign a side for a random matchup: a difficulty-weighted coin toward the
// hard (contrarian) side. Higher difficulty -> more likely the tough side.
export function assignSide(topic: BoardTopic, difficulty: Difficulty): string {
  return Math.random() < DIFFICULTY_META[difficulty].hardSideChance
    ? topic.hardSide
    : topic.easySide
}

// Given all rounds so far, which round + speaker goes next?
// Order per round: user first, then AI. Returns null when the debate is full.
export function nextTurn(rounds: RoundEntry[]): { round: RoundName; speaker: 'user' | 'ai' } | null {
  for (const round of ROUND_ORDER) {
    const entries = rounds.filter((r) => r.round === round)
    if (!entries.some((e) => e.speaker === 'user')) return { round, speaker: 'user' }
    if (!entries.some((e) => e.speaker === 'ai')) return { round, speaker: 'ai' }
  }
  return null
}

// ── Human vs Human (same-device live exhibition) ──────────────────
// Two people, one phone, all speech. No points, no stats, no badges —
// but a full AI verdict at the end, and it costs a ticket like any debate.

export type HumanSpeaker = 'host' | 'guest'

// Stored at debates.versus (jsonb), set once at insert. `first` is the
// setup-time coin flip: that speaker leads every round.
// Online ranked matches add: `online` (arena-rendering hint — the authoritative
// ranked marker is debates.opponent_user_id), `room_url` (the private Daily.co
// room both players join), and `abandon` (a pending disconnect claim written by
// the abandon route while the grace clock runs; cleared if the player rejoins).
export type VersusConfig = {
  guest_name: string
  guest_side: string
  turn_seconds: number
  first: HumanSpeaker
  online?: boolean
  room_url?: string
  abandon?: { absent: HumanSpeaker; since: string } | null
}

export const TURN_LENGTH_OPTIONS = [60, 90, 120] as const
export const HANDOFF_BREAK_SECONDS = 20 // between speakers inside a section
export const SECTION_BREAK_SECONDS = 40 // between sections (contention→rebuttal→summary)

// Placeholder text for a turn where transcription heard nothing usable.
// The judge prompt explains it; keeps the six-turn structure intact.
export const SILENT_TURN_TEXT = '[silence]'
export const REDACTED_TURN_TEXT = '[removed for inappropriate language]'

// ── Online ranked Human vs Human (2026-07-11) ─────────────────────
// Two accounts, remote, live video call (Daily.co). Unlike the same-device
// exhibition, online H2H is RANKED: points, wins/losses, streaks and badges
// all move, plus the separate h2h_wins/h2h_losses ledger. The ranked marker
// is debates.opponent_user_id (service-role-only, unforgeable) — versus.online
// is just the arena-rendering hint.

// Flat payout, deliberately NOT difficulty-scaled: both humans face the same
// topic, so a 3x hall-of-famer multiplier would be free inflation (difficulty
// only sets random-topic nicheness). Loss mirrors the vs-AI flat -25.
export const H2H_WIN_POINTS = 200
// Each repeat ranked win vs the SAME opponent within the last 24 HOURS pays 10%
// less than the last (200 -> 180 -> 162 …): anti-farming without zeroing out
// friendly rivalries. The window is a rolling day, not a calendar week, so the
// decay is a cooldown that clears rather than a weekly budget you burn through
// (founder call 2026-08-10). Window lives in lib/h2h-settle.ts
// (REMATCH_WINDOW_HOURS); this constant is only the per-repeat multiplier.
export const REMATCH_DECAY = 0.9

// Points delta for a ranked online H2H outcome. `priorWinsVsOpponent` = this
// winner's completed ranked wins against this same opponent inside the rematch
// window. Founding boost is applied by the caller via applyFounding, on top.
export function h2hPointsDelta(outcome: Outcome, priorWinsVsOpponent: number): number {
  if (outcome === 'win') {
    return Math.round(H2H_WIN_POINTS * Math.pow(REMATCH_DECAY, Math.max(0, priorWinsVsOpponent)))
  }
  if (outcome === 'flagged') return -MODERATION_PENALTY
  return -LOSS_PENALTY
}

// Disconnect policy: a player who drops gets this long to rejoin the room.
// If they don't come back, the match is VOIDED (no points, both cap slots
// refunded via status='void') when fewer than VOID_MIN_SUBMITTED rounds are
// in, and a FORFEIT (walkover win/loss) once the rebuttal is underway.
export const ABANDON_GRACE_SECONDS = 60
export const VOID_MIN_SUBMITTED = 2 // both contention turns submitted

// Open lobbies expire off the live board (and stop accepting joins) after this.
export const LOBBY_TTL_MINUTES = 60

// Freshness helpers live here (not inline in components) so render code stays
// pure under the react-hooks/purity rule.
export function lobbyFreshCutoffISO(): string {
  return new Date(Date.now() - LOBBY_TTL_MINUTES * 60 * 1000).toISOString()
}

export function lobbyExpired(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > LOBBY_TTL_MINUTES * 60 * 1000
}

// Turn order for an H2H debate: the coin-flip winner leads every round,
// the other speaker closes it. Returns null when all six turns are in.
export function nextHumanTurn(
  rounds: RoundEntry[],
  first: HumanSpeaker
): { round: RoundName; speaker: HumanSpeaker } | null {
  const second: HumanSpeaker = first === 'host' ? 'guest' : 'host'
  for (const round of ROUND_ORDER) {
    const entries = rounds.filter((r) => r.round === round)
    if (!entries.some((e) => e.speaker === first)) return { round, speaker: first }
    if (!entries.some((e) => e.speaker === second)) return { round, speaker: second }
  }
  return null
}
