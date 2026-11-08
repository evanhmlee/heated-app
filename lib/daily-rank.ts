// How votes move a take on the daily board.
//
// The judge scores 0-100. Votes are a MODIFIER on top of that, capped, never a
// replacement for it. The cap is the whole design: uncapped, the board becomes a
// popularity contest and the 300-point daily bonus goes to whoever has the most
// friends rather than whoever had the best take. Capped, votes decide close
// calls and reward a take people loved, but a well-liked mediocre take still
// cannot beat a genuinely better one from far behind.
//
// One point per net vote is deliberately the most explicable rule available. A
// user who asks "why is that take above mine" gets an answer they can count on
// their fingers, which no logarithmic or percentage curve can offer.

export const VOTE_BONUS_CAP = 25

/**
 * Net votes, clamped to the cap in BOTH directions.
 *
 * Symmetric on purpose. If likes could lift a take 25 places but dislikes could
 * not push it down, the rational play is to farm likes and ignore quality, and
 * the dislike button becomes decoration. A take the room actively disliked
 * should rank below where the judge left it.
 */
export function voteBonus(likes: number, dislikes: number): number {
  const net = likes - dislikes
  return Math.max(-VOTE_BONUS_CAP, Math.min(VOTE_BONUS_CAP, net))
}

/**
 * What the board sorts on. Deliberately NOT clamped to 100: this is a ranking
 * number, not a score, and squashing everything above 100 would silently undo
 * the bonus for exactly the takes that earned it most.
 *
 * The judge's 0-100 stays the headline everywhere in the UI and the bonus is
 * shown next to it as a separate signed pill, so the two numbers are never
 * confused for one another.
 */
export function blendedScore(score: number, likes: number, dislikes: number): number {
  return Math.max(0, score + voteBonus(likes, dislikes))
}

/** "+7", "-3", or "" when the votes have not moved it. */
export function bonusLabel(bonus: number): string {
  if (bonus === 0) return ''
  return bonus > 0 ? `+${bonus}` : String(bonus)
}
