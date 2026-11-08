"use client";

/*
 * The hero topic ticker, tappable. Each matchup opens an OPEN debate card: the
 * question, both sides, and a one-line case for each, with NO winner declared.
 * The point is to hand the visitor an argument to fling into their group chat
 * (the share button), not to settle it here. Every case is grounded in a real,
 * checkable fact; no invented stats.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Side = { name: string; case: string };
type Debate = {
  q: string; // ticker label + card title
  a: Side;
  b: Side;
};

// Order here is the marquee order.
const DEBATES: Debate[] = [
  {
    q: "LEBRON VS MJ",
    a: { name: "MJ", case: "Six-for-six in the Finals with six Finals MVPs. Never let a title slip." },
    b: { name: "LEBRON", case: "The all-time leading scorer, four rings across three teams, 20-plus years on top." },
  },
  {
    q: "RINGS OVER STATS?",
    a: { name: "RINGS", case: "Basketball is about winning. The banner is the only number that hangs from the rafters." },
    b: { name: "STATS", case: "Rings are a team trophy. Robert Horry has seven of them and he's not an all-timer." },
  },
  {
    q: "WHO WINS ROTY?",
    a: { name: "DYBANTSA", case: "The more complete two-way wing, and voters reward the guys who defend and score." },
    b: { name: "PETERSON", case: "The more explosive shot-creator, and the award usually follows the bigger numbers." },
  },
  {
    q: "'96 BULLS VS '17 WARRIORS",
    a: { name: "'96 BULLS", case: "72 wins, and Jordan and Pippen hounding you for 48 minutes. Nobody guards MJ." },
    b: { name: "'17 WARRIORS", case: "Four Hall-of-Famers and spacing the 90s never saw. They'd shoot the Bulls off the floor." },
  },
  {
    q: "KOBE TOP 5 ALL TIME?",
    a: { name: "YES", case: "Five rings, an 81-point night, and 20 years of being the most feared closer alive." },
    b: { name: "NO", case: "The top five is Jordan, LeBron, Kareem, Magic, Bird. Kobe leads the next tier." },
  },
  {
    q: "CURRY OVER MAGIC?",
    a: { name: "CURRY", case: "Rewired how the whole sport is played, four rings, the greatest shooter ever." },
    b: { name: "MAGIC", case: "Ran the greatest show ever, five rings, made everyone around him better." },
  },
  {
    q: "BEST DEFENDER EVER?",
    a: { name: "HAKEEM", case: "The all-time blocks leader with two DPOYs, anchoring a title defense from the rim out." },
    b: { name: "KAWHI", case: "The most complete perimeter lockdown ever, erasing the other team's best wing nightly." },
  },
  {
    q: "LUKA OR JOKIC?",
    a: { name: "JOKIC", case: "Three MVPs and a title in four years. The best player alive, no theatrics." },
    b: { name: "LUKA", case: "A walking 30-point triple-double who dragged a worse roster all the way to the Finals." },
  },
  {
    q: "SURVIVE THE 90s?",
    a: { name: "YES", case: "Today's athletes are bigger, stronger, and better conditioned than the 90s ever saw." },
    b: { name: "NO", case: "Hand-checking and hard fouls would eat today's finesse scorers alive." },
  },
  {
    q: "KD: BEST ISO SCORER?",
    a: { name: "YES", case: "Seven feet with a guard's handle and a release nobody can contest, clean or not." },
    b: { name: "NO", case: "Jordan and Kobe got their bucket against anyone without needing a size mismatch." },
  },
];

const SHARE_URL = "https://getheated.app";

// Tag the shared link with the debate so it's attributable and can deep-link
// straight into that matchup once the arena is live (harmlessly ignored today).
const slugify = (q: string) =>
  q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function DebateModal({
  d,
  ctaHref,
  ctaLabel,
  onClose,
}: {
  d: Debate;
  ctaHref: string;
  ctaLabel: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function share() {
    const url = `${SHARE_URL}?d=${slugify(d.q)}`;
    const text = `${d.q} ${d.a.name} or ${d.b.name}? Settle it on Heated.`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        // text carries the question; url carries the link to Heated.
        await navigator.share({ title: "Settle this on Heated", text, url });
      } else {
        // No share sheet (desktop): copy the message plus the link so the
        // pasted result always leads back to Heated.
        await navigator.clipboard.writeText(`${text} ${url}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* user dismissed the share sheet */
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-ink/80 p-5 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Debate: ${d.q}`}
    >
      <div
        className="bezel bezel-primary w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
          <span className="font-mono text-[11px] tracking-[0.3em] text-blaze-bright">
            PICK A SIDE
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="font-mono text-xs tracking-widest text-chalk/50 transition-colors hover:text-chalk"
          >
            CLOSE
          </button>
        </div>

        <p className="font-athletic px-5 py-5 text-center text-2xl font-black uppercase leading-none tracking-tight text-chalk">
          {d.q}
        </p>

        {/* Both sides, equal weight, no winner. Each gets a one-line case. */}
        <div className="relative grid grid-cols-2 border-t border-line">
          <div className="border-r border-line px-4 py-5">
            <p className="font-athletic text-xl font-black uppercase leading-none tracking-tight text-chalk">
              {d.a.name}
            </p>
            <p className="mt-2.5 text-xs leading-relaxed text-chalk/60">
              {d.a.case}
            </p>
          </div>
          <div className="px-4 py-5">
            <p className="font-athletic text-xl font-black uppercase leading-none tracking-tight text-chalk">
              {d.b.name}
            </p>
            <p className="mt-2.5 text-xs leading-relaxed text-chalk/60">
              {d.b.case}
            </p>
          </div>
          <span className="absolute left-1/2 top-[26px] -translate-x-1/2 rounded-full border border-line bg-ink px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest text-blaze-bright">
            OR
          </span>
        </div>

        {/* Share is icon-only: the glyph is universally read, and spelling it
            out cost the row half its width and made two equal-weight buttons
            compete. The CTA is the one that should win the eye. Never stacks,
            so the icon stays a square instead of a full-width mystery block. */}
        <div className="flex items-stretch gap-2 border-t border-line p-4">
          <button
            type="button"
            onClick={share}
            aria-label={copied ? "Link copied" : "Share this matchup"}
            title={copied ? "Link copied" : "Share"}
            className="press inline-flex w-14 shrink-0 items-center justify-center rounded-card bg-blaze text-white transition-colors hover:bg-blaze-bright"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-[18px] w-[18px]"
              aria-hidden
            >
              {copied ? (
                <path d="M20 6 9 17l-5-5" />
              ) : (
                <>
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <path d="M8.6 13.5l6.8 3.9M15.4 6.6l-6.8 3.9" />
                </>
              )}
            </svg>
          </button>
          <a
            href={ctaHref}
            onClick={onClose}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-card border border-line px-4 py-3 text-center font-mono text-[11px] font-bold uppercase tracking-widest text-chalk/80 transition-colors hover:border-blaze/50 hover:text-chalk"
          >
            {ctaLabel}
          </a>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function TopicTicker({
  ctaHref,
  ctaLabel,
}: {
  ctaHref: string;
  ctaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  return (
    <div className="reveal r4 relative z-10 border-t border-line bg-panel py-4">
      <div className="ticker-track hover:[animation-play-state:paused]">
        {[0, 1].map((copy) => (
          <div
            key={copy}
            aria-hidden={copy === 1}
            className={`flex shrink-0 items-baseline ${copy === 1 ? "ticker-dupe" : ""}`}
          >
            {DEBATES.map((d, i) => (
              <span
                key={d.q}
                className="flex items-baseline font-athletic text-2xl font-black uppercase md:text-3xl"
              >
                <button
                  type="button"
                  tabIndex={copy === 1 ? -1 : 0}
                  onClick={() => setActive(i)}
                  className={`inline-flex min-h-[44px] cursor-pointer items-center px-7 transition-colors hover:text-blaze-bright ${
                    i % 2 ? "text-stroke-chalk" : "text-chalk/85"
                  }`}
                >
                  {d.q}
                </button>
                <span className="text-blaze" aria-hidden>
                  /
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>

      {/* Hint that the marquee is interactive */}
      <p className="pointer-events-none mt-2.5 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-chalk/35">
        Tap a matchup to start the argument
      </p>

      {active !== null && (
        <DebateModal
          d={DEBATES[active]}
          ctaHref={ctaHref}
          ctaLabel={ctaLabel}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}
