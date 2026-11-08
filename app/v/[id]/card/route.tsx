import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { loadOgFonts, loadOgLogos, fetchVerdictShare, type VerdictShare } from '@/lib/og'
import { SHARE_FORMATS, isShareFormat, type ShareFormat } from '@/lib/share'

export const runtime = 'nodejs'

// The verdict card, rendered as a PNG in three shapes:
//   og     1200x630   link preview in iMessage, email, X, LinkedIn, Slack
//   square 1080x1080  what a group chat or feed post shows
//   story  1080x1920  the only shape an Instagram/Snapchat story accepts
//
// Public by design: holding the debate UUID is the authorization, and everything
// here is already on the public /v/[id] page. Both surfaces read through
// fetchVerdictShare, so a revoked verdict and a hidden name can never be live on
// one and not the other.
//
// Text and score only. No logos, jerseys, or player likenesses beyond our own
// mark (NBA IP guardrail).
//
// Lives at /v/[id]/card rather than /api/, see the note on cardPath in lib/share.

// Brand tokens, mirrored from globals.css @theme. Kept as literals because
// satori resolves no CSS variables.
const INK = '#070811'
const PANEL = '#0d0f1a'
const CHALK = '#f4f6fb'
const BLAZE = '#d81f1f'
const BLAZE_BRIGHT = '#f04a38'
const STEEL = '#5c2618'
const LINE = 'rgba(244,246,251,0.09)'
const MUTED = 'rgba(244,246,251,0.6)'
const FAINT = 'rgba(244,246,251,0.45)'

type Spec = {
  ring: number
  /** Type scale multiplier against the og baseline. */
  s: number
  pad: number
  /** Story needs deep top/bottom insets: Instagram and Snapchat draw their own
   *  chrome over roughly the top and bottom eighth of a 9:16 frame. */
  padTop: number
  padBottom: number
  topic: number
  /** Topic characters that survive before the headline is clipped. */
  topicChars: number
  note: number
  noteChars: number
  receipts: number
  receiptChars: number
  /** Scoreboard panel padding and the gap around it. Held separately from `s`
   *  because og is a wide, SHORT frame: everything vertical has to come down
   *  there or the footer runs off the bottom edge. */
  panelPad: number
  panelGap: number
  /** The footer deliberately does NOT scale with `s`. It is one long line plus a
   *  pill, and at 1.5x on a 1080px-wide story both halves wrapped onto two
   *  lines. Absolute sizes keep it a single row in every frame. */
  foot: number
  footTrack: number
}

const SPECS: Record<ShareFormat, Spec> = {
  // The link card is a thumbnail in a message thread. It carries the matchup and
  // the scoreline and nothing else: receipts at that size are unreadable grey
  // noise that only costs the height the scoreboard needs.
  og: {
    ring: 104, s: 1, pad: 56, padTop: 40, padBottom: 40,
    topic: 40, topicChars: 62, note: 20, noteChars: 104,
    receipts: 0, receiptChars: 0,
    panelPad: 20, panelGap: 18, foot: 15, footTrack: 1.8,
  },
  square: {
    ring: 176, s: 1.18, pad: 64, padTop: 60, padBottom: 60,
    topic: 52, topicChars: 76, note: 26, noteChars: 150,
    receipts: 2, receiptChars: 88,
    panelPad: 32, panelGap: 30, foot: 17, footTrack: 1.8,
  },
  story: {
    ring: 224, s: 1.5, pad: 76, padTop: 210, padBottom: 250,
    topic: 66, topicChars: 90, note: 33, noteChars: 230,
    receipts: 3, receiptChars: 104,
    panelPad: 34, panelGap: 32, foot: 19, footTrack: 1.8,
  },
}

function trim(text: string, limit: number): string {
  const t = text.trim()
  if (t.length <= limit) return t
  return `${t.slice(0, limit - 1).replace(/\s+\S*$/, '')}…`
}

// The score ring from the app's verdict card, redrawn as static SVG. The winner
// gets the ember stroke and the numeral; the loser stays desaturated. Keeping
// the accent on exactly one side is the tonal rule that makes a win read as a
// win at thumbnail size.
function ScoreRing({ score, size, win }: { score: number; size: number; win: boolean }) {
  const stroke = Math.round(size * 0.062)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score)) / 100
  const mid = size / 2

  return (
    <div style={{ display: 'flex', position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={mid} cy={mid} r={r} fill="none" stroke="rgba(244,246,251,0.07)" strokeWidth={stroke} />
        <circle
          cx={mid}
          cy={mid}
          r={r}
          fill="none"
          stroke={win ? BLAZE_BRIGHT : 'rgba(244,246,251,0.28)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform={`rotate(-90 ${mid} ${mid})`}
        />
      </svg>
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontFamily: 'Anton',
            fontSize: size * 0.4,
            lineHeight: 1,
            color: win ? BLAZE_BRIGHT : 'rgba(244,246,251,0.5)',
          }}
        >
          {score}
        </div>
      </div>
    </div>
  )
}

// One competitor: ring, outcome chip, name, and the side they argued (UX
// audit G1: "Curry or Klay?" with 78 and 64 did not tell a friend who won).
function Seat({
  score,
  name,
  side,
  won,
  lost,
  spec,
}: {
  score: number
  name: string
  side: string | null
  won: boolean
  lost: boolean
  spec: Spec
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
      <ScoreRing score={score} size={spec.ring} win={won} />
      <div
        style={{
          display: 'flex',
          fontFamily: 'Archivo',
          fontWeight: 700,
          fontSize: 15 * spec.s,
          letterSpacing: 3 * spec.s,
          marginTop: 18 * spec.s,
          paddingLeft: 12 * spec.s,
          paddingRight: 12 * spec.s,
          paddingTop: 6 * spec.s,
          paddingBottom: 6 * spec.s,
          color: won ? CHALK : FAINT,
          backgroundColor: won ? BLAZE : 'transparent',
          border: won ? `1px solid ${BLAZE}` : `1px solid ${LINE}`,
          borderRadius: 6,
        }}
      >
        {won ? 'WINNER' : lost ? 'TOOK THE L' : 'TIE'}
      </div>
      <div
        style={{
          display: 'flex',
          fontFamily: 'Archivo',
          fontSize: 19 * spec.s,
          letterSpacing: 1.5 * spec.s,
          marginTop: 12 * spec.s,
          color: won ? CHALK : MUTED,
        }}
      >
        {trim(name.toUpperCase(), 18)}
      </div>
      {side && (
        <div
          style={{
            display: 'flex',
            fontFamily: 'Archivo',
            fontSize: 14 * spec.s,
            letterSpacing: 1 * spec.s,
            marginTop: 6 * spec.s,
            color: FAINT,
          }}
        >
          {trim(`ARGUED ${side.toUpperCase()}`, 26)}
        </div>
      )}
    </div>
  )
}

function Card({
  d,
  format,
  logos,
}: {
  d: VerdictShare
  format: ShareFormat
  logos: { mark: string; wordmark: string }
}) {
  const { width, height } = SHARE_FORMATS[format]
  const spec = SPECS[format]
  const userWon = d.winner === 'user'
  const aiWon = d.winner === 'opponent'
  const opponentName = d.guestName ?? 'The AI'
  const receipts = d.receipts.slice(0, spec.receipts)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width,
        height,
        backgroundColor: INK,
        // The app's .mesh atmosphere, ported. This is the ONE sanctioned
        // gradient in the design system: a faint ember bloom behind the frame,
        // never a gradient wash over the content.
        backgroundImage:
          'radial-gradient(70% 50% at 50% 0%, rgba(216,31,31,0.20), transparent 62%),' +
          'radial-gradient(60% 45% at 100% 100%, rgba(122,15,15,0.22), transparent 60%)',
        paddingLeft: spec.pad,
        paddingRight: spec.pad,
        paddingTop: spec.padTop,
        paddingBottom: spec.padBottom,
        justifyContent: 'space-between',
      }}
    >
      {/* Wordmark + eyebrow */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logos.mark} width={36 * spec.s} height={36 * spec.s} alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logos.wordmark}
            width={128 * spec.s}
            height={18 * spec.s}
            alt="Heated"
            style={{ marginLeft: 12 * spec.s }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            fontFamily: 'Archivo',
            fontWeight: 700,
            fontSize: 15 * spec.s,
            letterSpacing: 5 * spec.s,
            color: BLAZE_BRIGHT,
          }}
        >
          THE VERDICT
        </div>
      </div>

      {/* Topic */}
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 26 * spec.s }}>
        <div
          style={{
            display: 'flex',
            fontFamily: 'Archivo',
            fontSize: 14 * spec.s,
            letterSpacing: 4 * spec.s,
            color: FAINT,
            marginBottom: 12 * spec.s,
          }}
        >
          THE TOPIC
        </div>
        <div
          style={{
            display: 'flex',
            fontFamily: 'Anton',
            fontSize: spec.topic,
            lineHeight: 1.04,
            textTransform: 'uppercase',
            color: CHALK,
          }}
        >
          {trim(d.topic, spec.topicChars)}
        </div>
      </div>

      {/* Scoreboard, on a machined panel. Hairline shell, a top-edge highlight
          strip, and an ember ambient glow: the .bezel / .bezel-primary pairing
          rebuilt without inset shadows, which satori renders inconsistently. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          backgroundColor: PANEL,
          border: `1px solid ${LINE}`,
          borderRadius: 20,
          boxShadow: `0 24px 70px -30px rgba(216,31,31,0.55)`,
          paddingTop: spec.panelPad,
          paddingBottom: spec.panelPad,
          paddingLeft: spec.panelPad,
          paddingRight: spec.panelPad,
          marginTop: spec.panelGap,
          marginBottom: spec.panelGap,
        }}
      >
        {/* Top-edge highlight: the milled-metal cue from .bezel */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: 20,
            right: 20,
            height: 1,
            backgroundColor: 'rgba(255,255,255,0.09)',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Seat
            score={d.userScore}
            name={d.username}
            side={d.userSide}
            won={userWon}
            lost={aiWon}
            spec={spec}
          />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              width: 1,
              alignSelf: 'stretch',
              backgroundColor: LINE,
            }}
          />
          <Seat
            score={d.aiScore}
            name={opponentName}
            side={d.guestSide ?? (d.guestName === null && d.userSide ? 'the other side' : null)}
            won={aiWon}
            lost={userWon}
            spec={spec}
          />
        </div>
      </div>

      {/* Judge's note, and the receipts behind it where there is room */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            fontFamily: 'Archivo',
            fontWeight: 700,
            fontSize: 14 * spec.s,
            letterSpacing: 4 * spec.s,
            color: BLAZE_BRIGHT,
            marginBottom: 12 * spec.s,
          }}
        >
          JUDGE&apos;S NOTE
        </div>
        <div
          style={{
            display: 'flex',
            fontFamily: 'Archivo',
            fontSize: spec.note,
            lineHeight: 1.42,
            color: 'rgba(244,246,251,0.85)',
          }}
        >
          {trim(d.note, spec.noteChars)}
        </div>

        {receipts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 22 * spec.s }}>
            {receipts.map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  marginTop: i === 0 ? 0 : 12 * spec.s,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    width: 7 * spec.s,
                    height: 7 * spec.s,
                    borderRadius: 999,
                    backgroundColor: BLAZE_BRIGHT,
                    marginTop: 10 * spec.s,
                    marginRight: 12 * spec.s,
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    fontFamily: 'Archivo',
                    fontSize: 18 * spec.s,
                    lineHeight: 1.4,
                    color: MUTED,
                  }}
                >
                  {trim(r, spec.receiptChars)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: `1px solid ${LINE}`,
          paddingTop: spec.panelGap,
          marginTop: spec.panelGap,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexShrink: 0,
            whiteSpace: 'nowrap',
            fontFamily: 'Archivo',
            fontSize: spec.foot,
            letterSpacing: spec.footTrack,
            color: FAINT,
          }}
        >
          AI JUDGE · REAL NBA STATS · NO HOMER REFS
        </div>
        <div
          style={{
            display: 'flex',
            flexShrink: 0,
            whiteSpace: 'nowrap',
            fontFamily: 'Archivo',
            fontWeight: 700,
            fontSize: spec.foot,
            letterSpacing: spec.footTrack,
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 8,
            paddingBottom: 8,
            borderRadius: 999,
            backgroundColor: STEEL,
            color: CHALK,
          }}
        >
          EVERY ARGUMENT, SETTLED
        </div>
      </div>
    </div>
  )
}

// Sample data so the card design can be opened and eyeballed without a real
// debate. Dev only: unreachable in any deployed build.
const DEMO: VerdictShare = {
  id: 'demo',
  username: 'bk_test_founder',
  named: true,
  topic: 'Jokic has already passed Duncan as the best big man ever',
  userSide: 'Yes',
  userScore: 81,
  aiScore: 62,
  winner: 'user',
  note: 'You carried the peak-value argument and backed it with the right numbers. The rebuttal on longevity never landed, but it did not have to once the efficiency case was made.',
  receipts: [
    'Cited Jokic 22.2 career PPG against Duncan 19.0, accurate per the verified line.',
    'Conceded the ring gap instead of dodging it, which kept the rest credible.',
    'Opponent leaned on defensive reputation without a single supporting number.',
  ],
  guestName: null,
  guestSide: null,
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const formatParam = req.nextUrl.searchParams.get('format')
  const format: ShareFormat = isShareFormat(formatParam) ? formatParam : 'og'
  const { width, height } = SHARE_FORMATS[format]

  const data =
    id === 'demo' && process.env.NODE_ENV === 'development'
      ? DEMO
      : await fetchVerdictShare(id)

  // A revoked, unfinished, or missing verdict has no card. 404 rather than a
  // branded placeholder: a placeholder would let a taken-down link keep
  // unfurling as though it were still live.
  if (!data) return new Response('Not found', { status: 404 })

  const [{ anton, archivo, archivoSemibold }, logos] = await Promise.all([
    loadOgFonts(),
    loadOgLogos(),
  ])

  return new ImageResponse(<Card d={data} format={format} logos={logos} />, {
    width,
    height,
    fonts: [
      { name: 'Anton', data: anton, weight: 400, style: 'normal' },
      { name: 'Archivo', data: archivo, weight: 400, style: 'normal' },
      // Registered at 700 so `fontWeight: 700` in the card resolves to it.
      { name: 'Archivo', data: archivoSemibold, weight: 700, style: 'normal' },
    ],
    headers: {
      // Short browser TTL so flipping a toggle refreshes the in-app preview
      // quickly; longer at the edge because scrapers hammer this on every paste.
      'cache-control': 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400',
    },
  })
}
