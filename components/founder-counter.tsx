"use client";

import { useEffect, useState } from "react";

// "X of 100 founder spots claimed" above the waitlist form. Deliberately
// renders NOTHING until 50 spots are gone (founder decision: "1 of 100"
// converts worse than silence), and switches copy once the 100 are filled.
// Renders nothing on fetch failure too, so the page never shows a broken
// counter.
const SHOW_AT = 50;
const CAP = 100;

export default function FounderCounter() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/waitlist/count")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.count === "number") setCount(d.count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (count === null || count < SHOW_AT) return null;

  const claimed = Math.min(count, CAP);
  return (
    <div className="mx-auto mt-6 w-full max-w-md">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-blaze-bright">
        {claimed >= CAP
          ? "ALL 100 FOUNDER SPOTS CLAIMED"
          : `${claimed} OF 100 FOUNDER SPOTS CLAIMED`}
      </p>
      <div
        className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-panel"
        role="progressbar"
        aria-valuenow={claimed}
        aria-valuemin={0}
        aria-valuemax={CAP}
        aria-label="Founder spots claimed"
      >
        <div
          className="h-full rounded-full bg-blaze"
          style={{ width: `${(claimed / CAP) * 100}%` }}
        />
      </div>
    </div>
  );
}
