// Shared helpers for the verdict-share feature. Client-safe: no node imports, so
// the share sheet, the public page, and the card route can all pull from here.

export type ShareFormat = 'og' | 'square' | 'story'

// og     -> link preview in iMessage, email, X, LinkedIn, Slack
// square -> what a group chat or feed post shows
// story  -> 9:16, the only shape an Instagram/Snapchat story accepts
export const SHARE_FORMATS: Record<ShareFormat, { width: number; height: number }> = {
  og: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
}

export function isShareFormat(v: string | null): v is ShareFormat {
  return v === 'og' || v === 'square' || v === 'story'
}

export function sharePath(id: string): string {
  return `/v/${id}`
}

// Deliberately NOT under /api/. A robots.txt with `Disallow: /api/` is standard
// boilerplate, and Facebook, X and LinkedIn all honour it, so an og:image served
// from /api/ unfurls as a blank preview the day someone adds that file. Heated
// has no robots.txt today; this keeps it from becoming a silent trap when it
// does. (Same reason PitchCoach's card lives at /s/[token]/card.)
//
// `v` busts the CDN cache when the sharer flips a toggle, so the preview in the
// share sheet always matches what a recipient actually gets.
export function cardPath(id: string, format: ShareFormat = 'og', v?: string | number): string {
  const q = new URLSearchParams({ format })
  if (v) q.set('v', String(v))
  return `/v/${id}/card?${q}`
}

// ─── Copy ────────────────────────────────────────────────────────────────────
// Written in the sharer's voice: they are the one hitting send, and the scoreline
// is the whole point of the message. Dry, no slang, no em dashes.

export type ShareCopy = {
  score: number
  opponentScore: number
  /** "the AI" for a solo debate, the guest/opponent's name for H2H. */
  opponentName: string
  outcome: 'won' | 'lost' | 'tied'
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function shareTitle(c: ShareCopy): string {
  if (c.outcome === 'won') return `I beat ${c.opponentName} ${c.score}-${c.opponentScore}`
  if (c.outcome === 'lost') return `${capitalize(c.opponentName)} got me ${c.opponentScore}-${c.score}`
  return `${c.score}-${c.opponentScore}, dead even`
}

export function shareBlurb(c: ShareCopy): string {
  const line = shareTitle(c)
  if (c.outcome === 'won') return `${line}. The AI judge called it. Think you'd have done better?`
  if (c.outcome === 'lost') return `${line}. The AI judge called it. Somebody go run it back.`
  return `${line}. The AI judge could not split us.`
}

export function mailtoHref(c: ShareCopy, url: string): string {
  const subject = encodeURIComponent(shareTitle(c))
  const body = encodeURIComponent(`${shareBlurb(c)}\n\n${url}`)
  return `mailto:?subject=${subject}&body=${body}`
}

// `sms:?&body=` is the form both iOS and Android accept. iOS wants the extra
// ampersand; Android tolerates it.
export function smsHref(c: ShareCopy, url: string): string {
  return `sms:?&body=${encodeURIComponent(`${shareBlurb(c)} ${url}`)}`
}

export function xHref(c: ShareCopy, url: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(shareBlurb(c))}&url=${encodeURIComponent(url)}`
}

// LinkedIn and Facebook both ignore prefilled text now and read the page's OG
// tags instead, so only the URL is worth sending.
export function linkedInHref(url: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`
}

export function facebookHref(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`
}
