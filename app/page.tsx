import Image from "next/image";
import Reveal from "@/components/scroll-reveal";
import WaitlistForm from "@/components/waitlist-form";
import FounderCounter from "@/components/founder-counter";
import LoopVideo from "@/components/loop-video";
import RankedMatchMock from "@/components/ranked-match-mock";
import TopicTicker from "@/components/topic-ticker";
import ProPlanCard from "@/components/pro-plan-card";
import { TICKET_RATES } from "@/lib/tickets";

// Pre-launch switch. When NEXT_PUBLIC_AUTH_LIVE !== "true" (production today),
// the landing runs in waitlist mode: CTAs point at the #early-access form and
// the app routes are blocked in proxy.ts. Flip the env var to "true" (dev
// preview) to expose real signup/login and the full app.
const AUTH_LIVE = process.env.NEXT_PUBLIC_AUTH_LIVE === "true";
const CTA_HREF = AUTH_LIVE ? "/auth/signup" : "#early-access";
const CTA_LABEL = AUTH_LIVE ? "Enter the arena" : "Get founder status";

/*
 * Landing page. Visual language: Nike x NBA 2K broadcast-athletic.
 * System rules (do not drift):
 * - Display type = .font-athletic (Archivo expanded) at giant scale,
 *   uppercase, weight 800-900. Everything else Geist / Geist Mono.
 * - Shape system: one soft radius everywhere (.bezel / rounded-card,
 *   ~16px, shape-consistency lock); the blade corner cut (.clip-blade)
 *   is reserved for the primary CTA button only.
 * - Cards are machined double-bezels (.bezel, +.bezel-primary for the
 *   hero surfaces). NO GRADIENTS on this page: no radial .mesh wash, no
 *   fading rules, no gradient fills on cards, buttons or text. Atmosphere
 *   is the .court-floor grid plus .grain over flat ink. (.mesh is still
 *   used inside the authed app; this rule is landing-page scoped.)
 *   Gradients that draw a PATTERN rather than a wash are fine: the
 *   court-floor grid lines, scanlines, and the game-btn hover shimmer are
 *   all built from them and all stay.
 * - Color (Heated rebrand, 2026-07-08): red is tonal sitewide now: the
 *   `blaze`/`steel` tokens in globals.css were repointed from blue to red
 *   (names kept as-is to avoid a repo-wide rename), so this page and the
 *   authed app (dashboard, arenas, verdict pages) share one red system.
 * - One marquee (topic ticker).
 * - CTA labels are locked per intent: signup = "Enter the arena",
 *   checkout = "Go Pro", login = "Sign in".
 * - Fold discipline: every section is one full-viewport fold
 *   (min-h-[100dvh], content vertically centered and sized to fit a
 *   ~800px-tall desktop viewport without scrolling). The ticker lives
 *   at the bottom of the hero fold; the footer at the bottom of the
 *   final fold. Mobile may exceed one screen (min-h, not h).
 * - Six folds, not eight (UX audit A, 2026-10-11, founder: "less
 *   cluttered"): the rounds fold became one line in the modes intro, and the
 *   points sheet and "Every argument leaves a record" became one fold. The
 *   judge cell repeated the verdict fold and the share cell sold a feature
 *   nobody shops for, so both went.
 * - Only true claims. Ranked video is sold as live only because it passed the
 *   two-phone test (2026-10-23), stats are "checked", never "verified against NBA.com",
 *   and the badges shown are badges that exist in lib/badges.ts.
 */

const MODES = [
  {
    sideA: "You",
    sideB: "the AI",
    body: "Pick a side and the AI argues the other, over the mic or in text. It brings stats and it does not get tired.",
    meta: "LIVE SPEECH · TEXT",
    tag: "",
    video: {
      mp4: "/video/modes-ai-loop.mp4",
      webm: "/video/modes-ai-loop.webm",
      poster: "/video/modes-ai-poster.jpg",
      label: "A real text debate against the AI ending in a scored verdict",
    },
  },
  {
    sideA: "You",
    sideB: "a friend",
    body: "Pass one phone back and forth. Two people, three timed rounds, one judge and one verdict. Just bragging rights on the line.",
    // "UNRANKED" not "EXHIBITION": the second needs sports jargon to decode.
    meta: "SAME DEVICE · UNRANKED",
    tag: "",
    video: {
      mp4: "/video/versus-loop.mp4",
      webm: "/video/versus-loop.webm",
      poster: "/video/versus-poster.jpg",
      label: "Two people passing one phone for a same-device debate",
    },
  },
  {
    sideA: "You",
    sideB: "the world",
    // Live since launch (2026-10-23), after the two-phone test passed.
    body: "Match a real person live on video. This is the ranked one, so winning moves you up the leaderboard.",
    meta: "LIVE VIDEO · RANKED",
    tag: "",
    video: null,
  },
];

// The points scale as a box score. Every number is the real constant from
// lib/debate.ts, so the page cannot drift from the app: BASE_WIN_POINTS 100 x
// DIFFICULTY_META multiplier (rookie 1 / starter 1.5 / all_star 2 /
// hall_of_famer 3), H2H_WIN_POINTS 200 flat, RANDOM_BONUS 1.25,
// REMATCH_DECAY 0.9 inside a rolling 24h window, LOSS_PENALTY 25 floored at 0.
const WIN_TABLE = [
  { label: "Beat the AI on Rookie", value: "+100" },
  { label: "Beat the AI on Starter", value: "+150" },
  { label: "Beat the AI on All-Star", value: "+200" },
  { label: "Beat the AI on Hall of Famer", value: "+300" },
  { label: "Beat a real person", value: "+200" },
];

// Short noun phrases, not sentences: these sit in a narrow column beside a
// value, and "You get a random topic and side" was the one row wrapping to two
// lines on a 375px screen.
const MODIFIER_TABLE = [
  { label: "Random topic and side", value: "x1.25" },
  { label: "Rematch within a day", value: "x0.9", dim: true },
  { label: "Any loss", value: "-25", dim: true },
];

// The in-app currency is called a ticket, but the landing page deliberately
// does NOT teach that word. A visitor deciding whether to sign up should not
// have to learn a noun first; they want to know how many debates they get, so
// these lists are written in debates and the app introduces "ticket" later.
//
// Each list opens with the rate, because the rate IS the limit a visitor
// feels: one a week on Free, 3 a day on Pro. The bank cap (3 and 25)
// only bites when you have been away, so where it appears it is phrased as
// the upside it actually is ("save up to 25") rather than as a ceiling.
// Pro names its number and Free does not, on purpose: 25 reads as generous,
// while 3 would read as the hard total the weekly rate already implies.
// Keep both lists the same length, they render side by side.
const FREE_PERKS = [
  "One free debate a week",
  "Every mode: text, mic, or pass the phone",
  "The full verdict, not just the score",
  "The daily question, always free",
  "Leaderboard, points and badges",
];

const PRO_PERKS = [
  "Three debates a day",
  "Argue with custom topics",
  "Deep Dive: see the judge's full reasoning",
  `Save up to ${TICKET_RATES.pro.bankCap} debates for a big week`,
  "Everything in Free",
];

// Labelled "Example" on the page: before launch there is no real board, and
// made-up names presented as a live one would be fake social proof. Keep them
// distinct from the verdict-demo debaters (Devin/Marcus).
const LEADERS = [
  { rank: "1", name: "Trey W.", pts: "1,284" },
  { rank: "2", name: "Keisha B.", pts: "1,142" },
  { rank: "3", name: "Andre P.", pts: "987" },
];

// Real badge names from lib/badges.ts. The old chips (5W STREAK, UPSET,
// FLAWLESS REBUTTAL) were never badges in the app.
const BADGES = ["ON FIRE", "FLAWLESS", "CERTIFIED HOOPER", "CROWN HOLDER"];

// The example verdict, shared by the hero card and the full verdict fold so
// the two can never disagree about who scored what.
const EXAMPLE = {
  topic: "LeBron over MJ?",
  winner: { name: "Devin", side: "LeBron", score: 88, rubric: [90, 88, 86] },
  loser: { name: "Marcus", side: "MJ", score: 74, rubric: [80, 64, 78] },
  rubric: ["Facts", "Logic", "Delivery"],
  // The hero's one line, cut from the full judge's note in the verdict fold.
  short:
    "Devin made LeBron\u2019s longevity look untouchable. Marcus had the rings, but never answered the era.",
};

// The first screen's proof: a compact verdict beside (laptop) or under
// (phone) the headline, so nobody has to scroll to learn what Heated gives
// back. Flat fills only, no gradients. The score bars show on laptops; a phone
// gets scores, sides and the judge's line, which is what fits above the fold.
function HeroVerdict() {
  const { winner, loser } = EXAMPLE;
  return (
    <div className="bezel bezel-primary p-4 sm:p-6">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-chalk/60">
        Example verdict
      </p>
      <p className="mt-2 font-athletic text-lg font-black uppercase leading-none tracking-tight sm:text-2xl">
        {EXAMPLE.topic}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-3">
        <div className="rounded-xl border border-blaze/35 bg-steel/35 px-3 py-2.5 sm:px-4 sm:py-3">
          <p className="font-athletic text-3xl font-black leading-none tabular-nums text-blaze-bright sm:text-5xl">
            {winner.score}
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold">
            {winner.name}
            <span className="bg-blaze px-1.5 py-0.5 font-mono text-[8.5px] font-bold tracking-widest text-white">
              WINNER
            </span>
          </p>
          <p className="text-xs text-chalk/60">argued {winner.side}</p>
        </div>
        <div className="rounded-xl border border-line px-3 py-2.5 sm:px-4 sm:py-3">
          <p className="font-athletic text-3xl font-black leading-none tabular-nums text-chalk/45 sm:text-5xl">
            {loser.score}
          </p>
          <p className="mt-1.5 text-sm font-semibold text-chalk/70">
            {loser.name}
          </p>
          <p className="text-xs text-chalk/50">argued {loser.side}</p>
        </div>
      </div>
      <div className="mt-4 hidden space-y-2 lg:block" aria-hidden>
        {EXAMPLE.rubric.map((label, i) => (
          <div
            key={label}
            className="grid grid-cols-[4.5rem_1fr_1fr] items-center gap-3"
          >
            <span className="text-xs text-chalk/60">{label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-line">
              <span
                className="block h-full rounded-full bg-blaze-bright"
                style={{ width: `${winner.rubric[i]}%` }}
              />
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-line">
              <span
                className="block h-full rounded-full bg-chalk/35"
                style={{ width: `${loser.rubric[i]}%` }}
              />
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-chalk/75 sm:mt-4">
        &ldquo;{EXAMPLE.short}&rdquo;
      </p>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen overflow-x-clip bg-ink text-chalk">
      <div className="grain" aria-hidden />

      <a
        href="#top"
        className="sr-only z-[60] focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:bg-blaze focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:tracking-widest"
      >
        SKIP TO CONTENT
      </a>

      {/* ── Nav ─────────────────────────────────────────────── */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-line bg-ink/85 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-5 sm:py-3.5">
          <a
            href="#top"
            className="flex shrink-0 items-center gap-1.5 font-athletic whitespace-nowrap text-[15px] font-black uppercase tracking-tight sm:gap-2 sm:text-lg"
          >
            <Image src="/logo-mark.png" alt="" width={64} height={64} className="h-8 w-8 -translate-y-0.5 sm:h-16 sm:w-16 sm:-translate-y-1" priority />
            <Image src="/wordmark-red.png" alt="Heated" width={253} height={36} className="h-4 w-auto sm:h-9" priority />
          </a>
          <div className="flex items-center gap-4">
            {AUTH_LIVE && (
              <a
                href="/auth/login"
                className="hidden whitespace-nowrap font-mono text-xs tracking-widest text-chalk/70 transition-colors hover:text-chalk sm:inline"
              >
                SIGN IN
              </a>
            )}
            <a
              href={CTA_HREF}
              className="game-btn clip-blade inline-flex min-h-[44px] items-center justify-center whitespace-nowrap px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-wide text-white sm:px-5 sm:py-3 sm:text-xs sm:tracking-widest"
            >
              {CTA_LABEL}
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        {/* ── Fold 1 · Hero: poster type + topic ticker ───────── */}
        <section className="relative flex min-h-[100dvh] flex-col overflow-hidden">
          {/* No .mesh here: the red radial wash read as soft AI-slop, the same
              call already made for the carousels. Atmosphere is the court-grid
              floor plus grain on flat ink, nothing else. The horizon rule
              went when the example verdict joined the fold: it ran through
              the copy on laptops and behind the card on phones. */}
          <div className="court-floor" aria-hidden />

          <div className="relative z-10 flex flex-1 items-center px-5 pb-6 pt-20 lg:pb-10">
            <div className="mx-auto grid w-full max-w-[1400px] gap-7 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center lg:gap-14">
              <div>
                {!AUTH_LIVE && (
                  /* The launch date, confirmed by the founder 2026-10-12. */
                  <p className="reveal r1 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-blaze-bright sm:mb-5">
                    <span>Launching October 20</span>
                    <span className="text-chalk/40" aria-hidden>
                      /
                    </span>
                    <span className="text-chalk/70">
                      First 100 get founder status
                    </span>
                  </p>
                )}
                <h1 className="reveal r1 font-athletic font-black uppercase leading-[0.86] tracking-tight text-[clamp(2.25rem,9.5vw,9.5rem)] lg:text-[clamp(3.75rem,5.5vw,6.75rem)]">
                  <span className="lg:block">Every</span> argument.
                  <br />
                  <span className="text-blaze-bright text-glow">
                    Settled.
                  </span>
                </h1>

                {/* No "stranger on video": ranked video is not open yet. */}
                <p className="reveal r2 mt-5 max-w-lg text-base leading-relaxed text-chalk/70 sm:mt-6 sm:text-lg">
                  Argue with the AI or a friend. A neutral judge scores every
                  round on facts, logic and delivery, and checks the stats you
                  name.
                </p>

                <div className="reveal r3 mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 sm:mt-8">
                  <a
                    href={CTA_HREF}
                    className="game-btn clip-blade px-8 py-4 font-mono text-sm font-bold uppercase tracking-widest text-white"
                  >
                    {CTA_LABEL}
                  </a>
                  <a
                    href="#verdict"
                    className="px-2 py-4 font-mono text-sm uppercase tracking-widest text-chalk/60 transition-colors hover:text-chalk"
                  >
                    See a full verdict
                  </a>
                </div>
              </div>

              <div className="reveal r3 w-full max-w-md lg:max-w-none">
                <HeroVerdict />
              </div>
            </div>
          </div>

          {/* Topic ticker (the page's one marquee), docked in the fold.
              Tappable: each matchup opens a canned verdict card. */}
          <TopicTicker ctaHref={CTA_HREF} ctaLabel={CTA_LABEL} />
        </section>

        {/* ── Fold 2 · Verdict: broadcast final-score bug ─────── */}
        <section
          id="verdict"
          className="flex min-h-[100dvh] flex-col justify-center border-t border-line px-5 pb-12 pt-20"
        >
          <div className="mx-auto w-full max-w-6xl">
            <Reveal>
              <h2 className="font-athletic max-w-4xl font-black uppercase leading-[0.92] tracking-tight text-[clamp(2rem,4.5vw,3.5rem)]">
                Every argument ends with a{" "}
                <span className="text-blaze-bright">score.</span>
              </h2>
            </Reveal>

            <div className="mt-8 grid gap-6 md:mt-10 md:grid-cols-[minmax(0,300px)_1fr] md:items-start md:gap-9">
              {/* Motion proof: a real debate captured end to end, ending in
                  the product's own verdict animation. Leads on mobile, flanks
                  the card on desktop. Poster = the static verdict still. */}
              <Reveal className="mx-auto w-full max-w-[300px] md:mx-0">
                <LoopVideo
                  mp4="/video/loop.mp4"
                  webm="/video/loop.webm"
                  poster="/video/poster.jpg"
                  label="A real Heated debate captured end to end, ending in a scored verdict"
                />
                <p className="mt-3 text-center font-mono text-[10px] tracking-[0.25em] text-chalk/40 md:text-left">
                  ACTUAL APP FOOTAGE
                </p>
              </Reveal>

              {/* Real component preview: this is the product's verdict
                surface, not decoration. */}
              <Reveal
                delay={120}
                className="bezel bezel-primary overflow-hidden"
              >
              <div className="border-b border-line px-6 py-2.5 md:px-10">
                <span className="font-mono text-[11px] tracking-[0.3em] text-chalk/60">
                  FINAL VERDICT
                </span>
              </div>

              <p className="font-athletic px-6 pt-6 text-center font-black uppercase leading-none tracking-tight text-[clamp(1.4rem,3vw,2.25rem)] md:px-10">
                {EXAMPLE.topic}
              </p>

              <div className="mt-6 grid grid-cols-2 border-t border-line">
                <div className="border-r border-line bg-steel/40 px-4 py-6 text-center md:py-8">
                  <p className="font-athletic font-black leading-none tabular-nums text-blaze-bright text-[clamp(3rem,8vw,6rem)]">
                    88
                  </p>
                  <p className="mt-3 text-lg font-semibold">Devin</p>
                  <p className="mt-1 font-mono text-[11px] tracking-[0.25em] text-chalk/60">
                    ARGUED FOR LEBRON
                  </p>
                  <span className="mt-3 inline-block bg-blaze px-3 py-1 font-mono text-[10px] font-bold tracking-widest text-white">
                    WINNER
                  </span>
                </div>
                <div className="px-4 py-6 text-center md:py-8">
                  <p className="font-athletic font-black leading-none tabular-nums text-chalk/35 text-[clamp(3rem,8vw,6rem)]">
                    74
                  </p>
                  <p className="mt-3 text-lg font-semibold text-chalk/60">
                    Marcus
                  </p>
                  <p className="mt-1 font-mono text-[11px] tracking-[0.25em] text-chalk/40">
                    ARGUED FOR MJ
                  </p>
                </div>
              </div>

              {/* The rubric receipts: same three categories the real judge
                  scores on, aligned under each debater's column. */}
              <div className="grid grid-cols-2 border-t border-line">
                <div className="space-y-1.5 border-r border-line bg-steel/40 px-4 py-4 md:px-10">
                  {[
                    ["FACTS", "90"],
                    ["LOGIC", "88"],
                    ["DELIVERY", "86"],
                  ].map(([label, score]) => (
                    <div
                      key={label}
                      className="flex items-baseline justify-between font-mono text-[11px] tracking-[0.2em]"
                    >
                      <span className="text-chalk/60">{label}</span>
                      <span className="font-bold tabular-nums text-blaze-bright">
                        {score}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5 px-4 py-4 md:px-10">
                  {[
                    ["FACTS", "80"],
                    ["LOGIC", "64"],
                    ["DELIVERY", "78"],
                  ].map(([label, score]) => (
                    <div
                      key={label}
                      className="flex items-baseline justify-between font-mono text-[11px] tracking-[0.2em]"
                    >
                      <span className="text-chalk/40">{label}</span>
                      <span className="tabular-nums text-chalk/50">
                        {score}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-line px-6 py-5 md:px-10 md:py-6">
                <p className="font-mono text-xs tracking-[0.3em] text-blaze-bright">
                  JUDGE&apos;S NOTE
                </p>
                <p className="mt-2 max-w-3xl leading-relaxed text-chalk/80">
                  &ldquo;Devin made LeBron&rsquo;s longevity look untouchable and
                  showed him dragging weaker rosters through elite competition.
                  Marcus had the rings, but never answered the era or the
                  mileage.&rdquo;
                </p>
                <p className="mt-3 flex items-start gap-2 font-mono text-[11px] leading-relaxed tracking-wide text-chalk/50">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mt-0.5 h-3 w-3 shrink-0 text-blaze-bright"
                    aria-hidden
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <span>
                    STAT CHECK: LEBRON IS THE NBA&apos;S ALL-TIME LEADING SCORER,
                    FINALS MVP FOR THREE FRANCHISES. CHECKED AGAINST HIS CAREER
                    NUMBERS.
                  </span>
                </p>
              </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Fold 3 · Modes: split screen, one divider, one VS ── */}
        <section className="flex min-h-[100dvh] flex-col justify-center border-t border-line py-20">
          <div className="mx-auto w-full max-w-[1400px] px-5">
            <Reveal>
              <h2 className="font-athletic font-black uppercase leading-[0.92] tracking-tight text-[clamp(2rem,4.5vw,3.5rem)]">
                Three ways to <span className="text-blaze-bright">debate.</span>
              </h2>
              {/* Do NOT promise "bring your own" here: custom topics are a Pro
                  perk, and this fold used to hand them to everyone. This line
                  is all that is left of the old three-rounds fold. */}
              <p className="mt-4 max-w-xl text-chalk/60">
                Every debate is three rounds, two minutes each: make your case,
                answer theirs, then close it out.
              </p>
            </Reveal>
          </div>

          <div className="mx-auto mt-8 w-full max-w-[1400px] border-t border-line md:mt-10 md:grid md:grid-cols-3">
            {MODES.map((m, i) => (
              <Reveal
                key={m.sideB}
                delay={i * 100}
                className={`border-line ${
                  i < MODES.length - 1 ? "border-b md:border-b-0 " : ""
                }${i > 0 ? "md:border-l" : ""}`}
              >
                <div className="flex h-full flex-col px-5 py-10 md:p-12">
                  <h3 className="font-athletic text-4xl font-black uppercase leading-[0.95] tracking-tight md:text-5xl">
                    {m.sideA} <span className="text-blaze-bright">vs</span>
                    <br />
                    {m.sideB}
                  </h3>
                  <p className="mt-5 max-w-md leading-relaxed text-chalk/60">
                    {m.body}
                  </p>
                  {m.video ? (
                    /* Real product motion for the mode. */
                    <div className="mt-7 w-full max-w-[172px]">
                      <LoopVideo
                        mp4={m.video.mp4}
                        webm={m.video.webm}
                        poster={m.video.poster}
                        label={m.video.label}
                      />
                    </div>
                  ) : (
                    /* Ranked ("vs the world") has no honest live-video capture
                       yet, so it gets a faceless code-built stand-in that keeps
                       the row's shape. */
                    <div className="mt-7 w-full max-w-[172px]">
                      <RankedMatchMock />
                    </div>
                  )}
                  <p className="mt-6 flex flex-1 items-end gap-2.5 font-mono text-[11px] tracking-[0.25em] text-chalk/60">
                    {m.tag && (
                      <span className="bg-blaze px-2 py-0.5 font-bold text-white">
                        {m.tag}
                      </span>
                    )}
                    {m.meta}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Fold 4 · The board: points sheet + record ─────────── */}
        <section className="flex min-h-[100dvh] flex-col justify-center border-t border-line px-5 py-20">
          <div className="mx-auto w-full max-w-6xl">
            <Reveal>
              <h2 className="font-athletic font-black uppercase leading-[0.92] tracking-tight text-[clamp(2rem,4.5vw,3.5rem)]">
                Climb the <span className="text-blaze-bright">board.</span>
              </h2>
              <p className="mt-4 max-w-xl text-chalk/60">
                Wins add points and every loss costs 25. The board starts fresh
                each Monday, right next to the all-time one.
              </p>
            </Reveal>

            <div className="mt-8 grid gap-4 md:mt-10 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              {/* The whole scale, as a box score: these are numbers, so they
                  get a stat sheet rather than prose. */}
              <Reveal>
                <div className="bezel bezel-primary h-full overflow-hidden">
                  <p className="px-6 pb-3 pt-5 font-mono text-[11px] font-bold tracking-[0.25em] text-blaze-bright">
                    WHAT A WIN PAYS
                  </p>
                  <ul className="divide-y divide-line border-y border-line">
                    {WIN_TABLE.map((r) => (
                      <li
                        key={r.label}
                        className="flex items-baseline justify-between gap-4 px-6 py-2.5"
                      >
                        <span className="text-sm text-chalk/70">{r.label}</span>
                        <span className="font-athletic text-lg font-black tabular-nums text-blaze-bright">
                          {r.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="px-6 pb-3 pt-5 font-mono text-[11px] font-bold tracking-[0.25em] text-chalk/50">
                    WHAT CHANGES IT
                  </p>
                  <ul className="divide-y divide-line border-t border-line">
                    {MODIFIER_TABLE.map((r) => (
                      <li
                        key={r.label}
                        className="flex items-baseline justify-between gap-4 px-6 py-2.5"
                      >
                        <span className="text-sm text-chalk/70">{r.label}</span>
                        <span
                          className={`font-athletic text-lg font-black tabular-nums ${
                            r.dim ? "text-chalk/45" : "text-blaze-bright"
                          }`}
                        >
                          {r.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="border-t border-line px-6 py-4 text-sm leading-relaxed text-chalk/55">
                    Your total never drops below zero, so take the hard matchup.
                    Games on one phone with a friend never count.
                  </p>
                </div>
              </Reveal>

              <Reveal delay={80}>
                <div className="bezel flex h-full flex-col p-6 md:p-8">
                  <p className="font-mono text-[11px] font-bold tracking-[0.25em] text-chalk/50">
                    EXAMPLE BOARD · THIS WEEK
                  </p>
                  <div className="mt-3 divide-y divide-line border-y border-line">
                    {LEADERS.map((l) => (
                      <div
                        key={l.rank}
                        className="flex items-baseline gap-4 py-2.5"
                      >
                        <span className="font-athletic w-5 font-black text-blaze-bright">
                          {l.rank}
                        </span>
                        <span className="flex-1 text-sm font-semibold">
                          {l.name}
                        </span>
                        <span className="font-mono text-sm tabular-nums text-chalk/60">
                          {l.pts}
                        </span>
                      </div>
                    ))}
                  </div>

                  <h3 className="mt-8 font-athletic text-xl font-black uppercase tracking-tight">
                    Earn your badges.
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-chalk/60">
                    Win streaks, scores of 90 and up, a Hall of Famer win. They
                    stay on your profile so people know who they&apos;re
                    arguing with.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {BADGES.map((b) => (
                      <span
                        key={b}
                        className="rounded-lg border border-steel bg-steel/40 px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest text-blaze-bright"
                      >
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Fold 5 · Pricing: dark vs solid red ───────────── */}
        <section className="flex min-h-[100dvh] flex-col justify-center border-t border-line px-5 py-20">
          <div className="mx-auto w-full max-w-6xl">
            <Reveal>
              <h2 className="font-athletic text-center font-black uppercase leading-[0.92] tracking-tight text-[clamp(2rem,4.5vw,3.5rem)]">
                Get <span className="text-blaze-bright">started.</span>
              </h2>
            </Reveal>

            <div className="mx-auto mt-8 grid max-w-4xl gap-4 md:mt-10 md:grid-cols-2">
              <Reveal className="h-full">
                {/* Every vertical here is mirrored in ProPlanCard so the two
                    cards line up row for row: the 44px title row (Pro's is
                    that tall because of the billing toggle), the mt-3 chip
                    slot, and the mt-6 divider above the perks. Change one and
                    change the other. */}
                <div className="bezel flex h-full flex-col p-6 md:p-8">
                  <div className="flex min-h-[48px] items-center">
                    <h3 className="font-athletic text-2xl font-black uppercase tracking-tight">
                      Free
                    </h3>
                  </div>
                  <div className="mt-5 flex items-end gap-3">
                    <p className="font-athletic text-5xl font-black leading-none tabular-nums">
                      $0
                    </p>
                    <p className="pb-1 font-mono text-[10px] tracking-[0.25em] text-chalk/60">
                      FOREVER
                    </p>
                  </div>
                  <p className="mt-3 text-chalk/60">For the casual fan.</p>
                  {/* Fills the slot opposite Pro's founding chip. Reserving
                      dead space would align the rows just as well, but this
                      says something worth saying. */}
                  <p className="mt-3 inline-flex w-fit items-center rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-chalk/70">
                    No card needed
                  </p>
                  <ul className="mt-6 flex-1 space-y-2.5 border-t border-line pt-5">
                    {FREE_PERKS.map((perk) => (
                      <li
                        key={perk}
                        className="flex items-start gap-3 text-sm text-chalk/70"
                      >
                        <span
                          className="font-mono font-bold text-blaze-bright"
                          aria-hidden
                        >
                          +
                        </span>
                        {perk}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={AUTH_LIVE ? "/auth/signup?plan=free" : "#early-access"}
                    className="mt-6 rounded-card border border-line px-6 py-3.5 text-center font-mono text-xs font-bold uppercase tracking-widest text-chalk/80 transition-colors hover:border-blaze/50 hover:text-chalk"
                  >
                    {CTA_LABEL}
                  </a>
                </div>
              </Reveal>

              <Reveal delay={100} className="h-full">
                <ProPlanCard
                  perks={PRO_PERKS}
                  ctaHref={AUTH_LIVE ? "/auth/signup?plan=pro" : "#early-access"}
                  ctaLabel={AUTH_LIVE ? "Go Pro" : "Get founder status"}
                />
              </Reveal>
            </div>

            {/* Packs are an in-app impulse buy, surfaced the moment someone
                runs out. One honest line here and no card: a third price block
                would turn Free vs Pro into a menu. "No subscription" is the
                load-bearing half, it is what separates this from Pro.
                NOT "run dry mid-argument": a debate is paid for when it starts,
                so nobody ever runs out partway through one. The real moment is
                finishing a debate and wanting to go again. */}
            <Reveal delay={160}>
              <p className="mx-auto mt-6 max-w-md text-center text-sm text-chalk/50">
                Out of debates and want to keep going? Buy 10 more for $1.99.
                No subscription, and they come with Pro turned on.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── Fold 6 · Final CTA + footer, closing the loop ───── */}
        <section
          id="early-access"
          className="relative flex min-h-[100dvh] flex-col overflow-hidden border-t border-line scroll-mt-16"
        >
          <div className="court-floor" aria-hidden />
          <div className="relative z-10 flex flex-1 items-center px-5 pt-16 text-center">
            <Reveal className="mx-auto w-full max-w-4xl">
              <h2 className="font-athletic font-black uppercase leading-[0.9] tracking-tight text-[clamp(2.5rem,7vw,5.5rem)]">
                First 100 get
                <br />
                <span className="text-blaze-bright">founder status.</span>
              </h2>

              {/* Founding perks, shown in both waitlist and live modes. */}
              {/* The paragraph that used to sit here listed the same three
                  perks as the chips below it. The chips say it faster, so the
                  space now goes to the thing nothing on the page explained:
                  what actually happens after you hand over an email.
                  The discount is permanent, not a first-payment hook: a one-off
                  half-price month is a coupon, and coupons do not make anyone
                  feel early. */}
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <span className="inline-flex items-center rounded-full border border-blaze/40 bg-steel/20 px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-widest text-blaze-bright">
                  30% off everything, forever
                </span>
                <span className="inline-flex items-center rounded-full border border-line bg-panel px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-chalk/70">
                  +20% points per win
                </span>
                <span className="inline-flex items-center rounded-full border border-line bg-panel px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-chalk/70">
                  Founding Member badge
                </span>
              </div>

              {AUTH_LIVE ? (
                <>
                  <p className="mx-auto mt-8 max-w-md text-chalk/60">
                    Verdicts are live. Create your account and bring your worst
                    takes.
                  </p>
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                    <a
                      href="/auth/signup"
                      className="game-btn clip-blade px-8 py-4 font-mono text-sm font-bold uppercase tracking-widest text-white"
                    >
                      Enter the arena
                    </a>
                    <a
                      href="/auth/login"
                      className="px-2 py-4 font-mono text-sm uppercase tracking-widest text-chalk/60 transition-colors hover:text-chalk"
                    >
                      Sign in
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <p className="mx-auto mt-7 max-w-md text-chalk/60">
                    Launching October 20.
                  </p>
                  <FounderCounter />
                  <div className="mt-7">
                    <WaitlistForm />
                  </div>

                  {/* Nothing on the page told a visitor what an email actually
                      buys them or when. Sits after the form so it never delays
                      the one action that matters, and each step is held to a
                      single line at max-w-4xl: this fold is the tightest on the
                      page and the founder counter still has to fit above. */}
                  <ol className="mx-auto mt-8 grid max-w-4xl gap-4 border-t border-line pt-6 text-left sm:grid-cols-3">
                    {[
                      { n: "01", body: "You drop your email. No card needed." },
                      { n: "02", body: "Launch day, you get the link first." },
                      { n: "03", body: "First 100 lock the perks permanently." },
                    ].map((s) => (
                      <li key={s.n}>
                        <p className="font-mono text-[11px] font-bold tracking-[0.3em] text-blaze-bright">
                          {s.n}
                        </p>
                        <p className="mt-1.5 text-sm leading-relaxed text-chalk/60">
                          {s.body}
                        </p>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </Reveal>
          </div>

          {/* Footer, docked at the bottom of the final fold */}
          <footer className="relative z-10 border-t border-line px-5 py-6">
            <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 font-mono text-[11px] tracking-[0.25em] text-chalk/45">
              <span>© 2026 HEATED</span>
              <span className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <a
                  href="https://www.instagram.com/getheatedapp"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Heated on Instagram"
                  className="-m-3 inline-flex h-11 w-11 items-center justify-center p-3 transition-colors hover:text-chalk"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4"
                    aria-hidden
                  >
                    <rect x="2" y="2" width="20" height="20" rx="5" />
                    <circle cx="12" cy="12" r="4.2" />
                    <circle
                      cx="17.4"
                      cy="6.6"
                      r="1.1"
                      fill="currentColor"
                      stroke="none"
                    />
                  </svg>
                </a>
                <a
                  href="https://www.tiktok.com/@getheatedapp"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Heated on TikTok"
                  className="-m-3 inline-flex h-11 w-11 items-center justify-center p-3 transition-colors hover:text-chalk"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-4 w-4"
                    aria-hidden
                  >
                    <path d="M19.32 5.56a5.12 5.12 0 0 1-3.08-2.94A5.09 5.09 0 0 1 15.96 1h-3.45v13.94a2.89 2.89 0 1 1-2.89-2.89c.3 0 .58.05.85.13V8.65a6.34 6.34 0 1 0 5.49 6.29V8.9a8.52 8.52 0 0 0 4.98 1.6V7.05a5.1 5.1 0 0 1-1.62-1.49z" />
                  </svg>
                </a>
                <a
                  href="/privacy"
                  className="-my-3 inline-flex min-h-[44px] items-center transition-colors hover:text-chalk"
                >
                  PRIVACY
                </a>
                <a
                  href="/terms"
                  className="-my-3 inline-flex min-h-[44px] items-center transition-colors hover:text-chalk"
                >
                  TERMS
                </a>
              </span>
            </div>
            <p className="mx-auto mt-4 max-w-[1400px] text-[11px] leading-relaxed text-chalk/40">
              Not affiliated with, endorsed by, or sponsored by the NBA, any
              NBA team, or any player.
            </p>
          </footer>
        </section>
      </main>
    </div>
  );
}
