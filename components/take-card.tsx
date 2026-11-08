'use client'

import { useState } from 'react'
import {
  ThumbsUp,
  ThumbsDown,
  ChatCircle,
  Sword,
  Scales,
  CaretDown,
} from '@phosphor-icons/react/dist/ssr'
import { VOTE_BONUS_CAP, bonusLabel, voteBonus } from '@/lib/daily-rank'

// One take on the daily feed.
//
// This replaces a board row that was a username and a number. The take itself,
// which is the only thing anyone actually wants to read, was sitting in the
// database rendered to nobody, and so was the judge's note, which is the most
// argued-with sentence the app produces.
//
// Presentational. Every action is a prop, so the same component serves the live
// feed, the preview harness, and later the public share page, and none of them
// can drift on what a take looks like.

export type Vote = 1 | -1 | 0

export type TakeCardData = {
  id: string
  rank: number
  username: string
  isMine: boolean
  side: string | null
  argument: string
  score: number
  facts: number
  logic: number
  delivery: number
  note: string
  likes: number
  dislikes: number
  myVote: Vote
  replies: { id: string; username: string; body: string; isMine: boolean }[]
}

const META = 'font-mono text-[10px] font-bold tracking-[0.25em] text-chalk-3'

function scoreTone(n: number): string {
  if (n >= 80) return 'text-chalk'
  if (n >= 60) return 'text-chalk-2'
  return 'text-chalk-3'
}

/**
 * The vote pair. Toggles: pressing your own vote again clears it, which is why
 * these are aria-pressed buttons rather than a radio group (a radio group cannot
 * return to empty).
 *
 * Counts are always visible, including the dislikes. A hidden dislike count is
 * a number the product is embarrassed by, and if it is going to move the board
 * it has to be legible.
 */
function VoteButtons({
  likes,
  dislikes,
  myVote,
  onVote,
}: {
  likes: number
  dislikes: number
  myVote: Vote
  onVote: (v: Vote) => void
}) {
  const base =
    'press inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 font-mono text-[11px] font-bold tabular-nums transition-colors'
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-pressed={myVote === 1}
        aria-label={`Like this take. ${likes} likes`}
        onClick={() => onVote(myVote === 1 ? 0 : 1)}
        className={`${base} ${
          myVote === 1
            ? 'border-blaze bg-steel text-blaze-bright'
            : 'border-line-strong text-chalk-3 hover:border-blaze/50 hover:text-chalk'
        }`}
      >
        <ThumbsUp size={14} weight={myVote === 1 ? 'fill' : 'regular'} aria-hidden />
        {likes}
      </button>
      <button
        type="button"
        aria-pressed={myVote === -1}
        aria-label={`Dislike this take. ${dislikes} dislikes`}
        onClick={() => onVote(myVote === -1 ? 0 : -1)}
        className={`${base} ${
          myVote === -1
            ? 'border-chalk/40 bg-panel-hi text-chalk'
            : 'border-line-strong text-chalk-3 hover:border-chalk/40 hover:text-chalk'
        }`}
      >
        <ThumbsDown size={14} weight={myVote === -1 ? 'fill' : 'regular'} aria-hidden />
        {dislikes}
      </button>
    </div>
  )
}

/**
 * The challenge panel. Async leads because it is the only mode that works when
 * the other person is not online, which at current traffic is nearly always.
 * Live is offered second and honestly labelled as needing them present.
 */
function ChallengePanel({
  username,
  onPick,
}: {
  username: string
  onPick: (mode: 'async' | 'live') => void
}) {
  const opt =
    'press w-full rounded-card border p-4 text-left transition-colors border-line-strong hover:border-blaze/60'
  return (
    <div className="mt-4 rounded-card border border-blaze/40 bg-ink/40 p-4">
      <p className={META}>CHALLENGE {username.toUpperCase()}</p>
      <p className="mt-2 text-sm leading-relaxed text-chalk-2">
        Their take above is their opening argument. You get to tear it down, they
        get to defend it, and the judge settles it. Points are on the line for
        both of you and the winner moves on today&apos;s board.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button type="button" className={opt} onClick={() => onPick('async')}>
          <span className="font-athletic text-lg font-black uppercase tracking-tight text-chalk">
            Async
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-chalk-3">
            Write when you want. They have 24 hours to answer. Once they accept,
            running out the clock is a loss.
          </span>
          <span className="mt-2 block font-mono text-[10px] tracking-[0.2em] text-blaze-bright">
            COSTS 1 TICKET
          </span>
        </button>
        <button type="button" className={opt} onClick={() => onPick('live')}>
          <span className="font-athletic text-lg font-black uppercase tracking-tight text-chalk">
            Live
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-chalk-3">
            Face to face, right now, on the clock. They have to be online to
            accept it.
          </span>
          <span className="mt-2 block font-mono text-[10px] tracking-[0.2em] text-blaze-bright">
            COSTS 1 TICKET
          </span>
        </button>
      </div>
    </div>
  )
}

export default function TakeCard({
  take,
  onVote,
  onReply,
  onChallenge,
  defaultOpen = false,
}: {
  take: TakeCardData
  onVote: (id: string, v: Vote) => void
  onReply: (id: string, body: string) => void
  onChallenge: (id: string, mode: 'async' | 'live') => void
  defaultOpen?: boolean
}) {
  const [openReplies, setOpenReplies] = useState(defaultOpen)
  const [challenging, setChallenging] = useState(false)
  const [draft, setDraft] = useState('')

  const bonus = voteBonus(take.likes, take.dislikes)
  const label = bonusLabel(bonus)
  const capped = Math.abs(bonus) === VOTE_BONUS_CAP

  return (
    <article
      className={`bezel overflow-hidden ${take.isMine ? 'ring-1 ring-blaze/40' : ''}`}
    >
      {/* Header: who, and what the board is ranking them on. The judge's 0-100
          stays the headline and the vote bonus sits beside it as a signed pill,
          so nobody has to work out which number the AI actually gave. */}
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <span className="font-athletic text-lg font-black tabular-nums text-blaze-bright">
          {take.rank}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-chalk">
          {take.username}
          {take.isMine && (
            <span className="ml-2 rounded-full bg-blaze px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest text-white">
              YOU
            </span>
          )}
        </span>

        {take.side && (
          <span className="hidden shrink-0 rounded-full border border-line-strong px-2.5 py-0.5 font-mono text-[10px] tracking-widest text-chalk-3 sm:inline">
            {take.side}
          </span>
        )}

        <span className="flex shrink-0 items-baseline gap-2">
          <span
            className={`font-athletic text-2xl font-black tabular-nums ${scoreTone(take.score)}`}
          >
            {take.score}
          </span>
          {label && (
            <span
              title={
                capped
                  ? `Votes are capped at ${VOTE_BONUS_CAP}`
                  : 'Net votes, applied to the board ranking'
              }
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                bonus > 0
                  ? 'bg-steel text-blaze-bright'
                  : 'bg-panel-hi text-chalk-3'
              }`}
            >
              {label}
              {capped ? ' MAX' : ''}
            </span>
          )}
        </span>
      </div>

      {/* The take. The entire reason this component exists. */}
      <div className="px-5 py-4">
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-chalk-2">
          {take.argument}
        </p>
      </div>

      {/* The judge's note, marked as the judge speaking rather than the author.
          Without the rule and the icon it reads as a second paragraph of the
          take, which is the one misreading that would make the feed useless. */}
      <div className="mx-5 mb-4 rounded-card border border-line bg-ink/40 p-4">
        <p className="flex items-center gap-2">
          <Scales size={13} weight="fill" aria-hidden className="text-blaze-bright" />
          <span className={META}>THE JUDGE</span>
        </p>
        <p className="mt-2 text-sm leading-relaxed text-chalk-2">{take.note}</p>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] tracking-[0.2em] text-chalk-3">
          <span>FACTS {take.facts}</span>
          <span>LOGIC {take.logic}</span>
          <span>DELIVERY {take.delivery}</span>
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        <VoteButtons
          likes={take.likes}
          dislikes={take.dislikes}
          myVote={take.myVote}
          onVote={(v) => onVote(take.id, v)}
        />

        <button
          type="button"
          aria-expanded={openReplies}
          onClick={() => setOpenReplies((v) => !v)}
          className="press inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-line-strong px-3 font-mono text-[11px] font-bold tabular-nums text-chalk-3 transition-colors hover:border-blaze/50 hover:text-chalk"
        >
          <ChatCircle size={14} aria-hidden />
          {take.replies.length}
          <CaretDown
            size={10}
            weight="bold"
            aria-hidden
            className={`transition-transform ${openReplies ? 'rotate-180' : ''}`}
          />
        </button>

        {/* You cannot challenge yourself, and the button is absent rather than
            disabled: a dead control on your own card is a question the reader
            has to answer for no reason. */}
        {!take.isMine && (
          <button
            type="button"
            aria-expanded={challenging}
            onClick={() => setChallenging((v) => !v)}
            className="press ml-auto inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-blaze/50 px-3 font-mono text-[11px] font-bold tracking-widest text-blaze-bright transition-colors hover:bg-steel"
          >
            <Sword size={14} weight="fill" aria-hidden />
            CHALLENGE
          </button>
        )}
      </div>

      {challenging && !take.isMine && (
        <div className="px-5 pb-5">
          <ChallengePanel
            username={take.username}
            onPick={(mode) => {
              onChallenge(take.id, mode)
              setChallenging(false)
            }}
          />
        </div>
      )}

      {openReplies && (
        <div className="border-t border-line bg-ink/30 px-5 py-4">
          {take.replies.length === 0 ? (
            <p className="text-sm text-chalk-3">
              Nobody has said anything back yet. Go first.
            </p>
          ) : (
            <ul className="space-y-3">
              {take.replies.map((r) => (
                <li key={r.id} className="border-l-2 border-line-strong pl-3">
                  <p className="font-mono text-[11px] font-bold tracking-widest text-chalk-3">
                    {r.username.toUpperCase()}
                    {r.isMine && <span className="ml-2 text-blaze-bright">YOU</span>}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-chalk-2">{r.body}</p>
                </li>
              ))}
            </ul>
          )}

          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const body = draft.trim()
              if (!body) return
              onReply(take.id, body)
              setDraft('')
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              placeholder="Say it back"
              aria-label={`Reply to ${take.username}`}
              className="min-h-[44px] flex-1 rounded-card border border-line-strong bg-ink px-3 text-sm text-chalk placeholder:text-chalk-3 focus:border-blaze focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="press min-h-[44px] shrink-0 rounded-card bg-blaze px-4 font-mono text-[11px] font-bold tracking-widest text-white transition-opacity disabled:opacity-40"
            >
              REPLY
            </button>
          </form>
        </div>
      )}
    </article>
  )
}
