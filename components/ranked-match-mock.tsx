"use client";

/*
 * Ranked "You vs the world" placeholder. The live-video ranked mode can't be
 * filmed honestly yet (a real Daily room + two people on camera, and we will
 * not stage real faces), so this is a code-built stand-in that takes the shape
 * of the other two mode videos: same phone bezel, same portrait aspect. It
 * mirrors the real arena (two tiles, LIVE label, a turn clock, "winner takes
 * the points") with abstract avatars instead of faces, so it reads as a
 * stylized product diagram, never as a captured screen.
 *
 * Motion: a JS turn clock. The active player's ring counts down (number +
 * depleting stroke); when it hits zero the turn switches to the other player
 * and their ring starts. Frozen on the opponent's turn under reduced motion.
 */

import { useEffect, useState } from "react";

// A real turn is 2:00; here it's fast-forwarded so the loop stays short.
const TURN_TOTAL = 120; // seconds shown on the clock (2:00)
const TICK_MS = 100;
const TICKS_PER_TURN = 48; // ~4.8s to sweep 2:00 -> 0:00, then hand off
const R = 44;
const CIRC = 2 * Math.PI * R; // ~276.5

const fmtClock = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Faceless camera-tile stand-in: a bust silhouette on the panel fill (the
// app's own honest cam-off state).
function AvatarTile({ tint, dim }: { tint: "chalk" | "brand"; dim: boolean }) {
  const fill =
    tint === "brand" ? "rgba(240,74,56,0.30)" : "rgba(244,246,251,0.16)";
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden
      className={`absolute left-1/2 top-1/2 h-1/2 w-auto -translate-x-1/2 -translate-y-1/2 transition-opacity duration-500 ${
        dim ? "opacity-40" : "opacity-100"
      }`}
    >
      <circle cx="32" cy="24" r="12" fill={fill} />
      <path d="M10 60c0-13 10-21 22-21s22 8 22 21z" fill={fill} />
    </svg>
  );
}

// Countdown clock over the active tile: depleting ring + the M:SS numeral.
function CountdownRing({ pct, label }: { pct: number; label: string }) {
  const offset = CIRC * (1 - Math.max(0, Math.min(1, pct)));
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="relative flex w-[42%] items-center justify-center">
        <svg viewBox="0 0 100 100" className="w-full -rotate-90" aria-hidden>
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="rgba(244,246,251,0.14)"
            strokeWidth="7"
          />
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="var(--color-blaze-bright)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 120ms linear" }}
          />
        </svg>
        <span className="absolute font-mono text-[9px] font-bold tabular-nums leading-none text-chalk">
          {label}
        </span>
      </div>
    </div>
  );
}

function Tile({
  name,
  tint,
  active,
  pct,
  label,
  big,
}: {
  name: string;
  tint: "chalk" | "brand";
  active: boolean;
  pct: number;
  label: string;
  big?: boolean;
}) {
  return (
    <div
      className={`relative mx-3 mt-2 overflow-hidden rounded-lg border bg-panel transition-colors duration-300 ${
        big ? "flex-1" : "h-[24%]"
      } ${
        active
          ? "border-blaze-bright/70 shadow-[inset_0_0_16px_rgba(240,74,56,0.18)]"
          : "border-line"
      }`}
    >
      <AvatarTile tint={tint} dim={!active} />
      {active ? (
        <>
          <CountdownRing pct={pct} label={label} />
          <span className="absolute right-2 top-1.5 flex items-center gap-1 font-mono text-[5.5px] tracking-widest text-blaze-bright">
            <span className="live-dot h-1 w-1 rounded-full bg-blaze-bright" />
            ON THE CLOCK
          </span>
        </>
      ) : (
        <span className="absolute right-2 top-1.5 font-mono text-[5.5px] tracking-widest text-chalk/35">
          UP NEXT
        </span>
      )}
      <span className="absolute bottom-1.5 left-2 font-mono text-[6.5px] tracking-widest text-chalk/80">
        {name}
      </span>
    </div>
  );
}

export default function RankedMatchMock({
  className = "",
}: {
  className?: string;
}) {
  // One pure tick counter drives everything; turn + remaining are derived from
  // it. (Mutating a second piece of state inside another setter's updater is a
  // side effect that React StrictMode double-invokes in dev, which silently
  // cancels the hand-off — so keep the source of truth to a single counter.)
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const pos = tick % (TICKS_PER_TURN * 2);
  const turn: "opp" | "you" = pos < TICKS_PER_TURN ? "opp" : "you";
  const step = pos % TICKS_PER_TURN; // 0..TICKS_PER_TURN-1
  const pct = 1 - step / (TICKS_PER_TURN - 1); // 1 at 2:00, 0 at 0:00
  const label = fmtClock(Math.round(TURN_TOTAL * pct));

  return (
    <div
      role="img"
      aria-label="Ranked live-video match: you versus a real opponent, one turn clock running, winner takes the points"
      className={`overflow-hidden rounded-[34px] border-[9px] border-[#1a1d24] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)] ${className}`}
    >
      <div className="relative flex aspect-[390/844] w-full flex-col bg-ink">
        {/* Header, mirroring the arena's */}
        <div className="flex items-center justify-between px-3 pt-3">
          <span className="font-athletic text-[11px] font-black uppercase leading-none tracking-tight text-blaze-bright">
            Heated
          </span>
          <span className="font-mono text-[6px] tracking-[0.2em] text-chalk/45">
            RANKED
          </span>
        </div>
        <p className="mt-1.5 flex items-center gap-1 px-3 font-mono text-[6px] tracking-[0.18em] text-blaze-bright">
          <span className="live-dot h-1 w-1 rounded-full bg-blaze-bright" />
          LIVE VIDEO
        </p>

        <Tile
          name="ANDRE_P"
          tint="chalk"
          big
          active={turn === "opp"}
          pct={pct}
          label={label}
        />
        <Tile
          name="YOU"
          tint="brand"
          active={turn === "you"}
          pct={pct}
          label={label}
        />

        {/* Footer: the ranked stakes */}
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <span className="font-mono text-[5.5px] tracking-[0.18em] text-chalk/45">
            WINNER TAKES THE POINTS
          </span>
          <span className="font-mono text-[7px] font-bold tracking-widest text-blaze-bright">
            +24
          </span>
        </div>
      </div>
    </div>
  );
}
