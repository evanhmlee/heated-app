"use client";

import { useState } from "react";
import {
  PRO_FOUNDING_PRICE_LABEL,
  PRO_PRICE_LABEL,
  PRO_WEEKLY_FOUNDING_PRICE_LABEL,
  PRO_WEEKLY_PRICE_LABEL,
} from "@/lib/tickets";

// The Pro pricing card, split out of the landing page because the billing
// toggle needs state and app/page.tsx is a server component.
//
// Two periods, one card. A third card would sit the two Pro prices next to each
// other and turn the section into a value comparison. The toggle keeps the
// section as Free vs Pro and makes the period a preference rather than a
// trade-off.
//
// Weekly or monthly (founder call 2026-10-11: weekly replaced annual). Most
// people want Heated for a stretch, a playoff run or a trade-deadline week, not
// a year, so the short plan is the one worth offering next to monthly. Both
// carry the same three tickets a day, which keeps the allowance one sentence:
// the period is only how often you pay. Weekly is the default and comes first
// (founder call 2026-10-12): it is the smaller first step, and four weeks of it
// ($11.96) still makes monthly the obvious pick for anyone who keeps playing.
//
// `foundingLabel` spells the founding offer out in money, because what a
// visitor wants is the number they will actually be charged. Founding is 30%
// off, permanent, and applies to BOTH periods (lib/stripe FOUNDING_APPLIES):
// the final CTA fold promises "30% off everything, forever", so a weekly card
// that quietly showed list price would be telling a visitor one thing and
// billing them another.
//
// This is also the server-rendered price, so it is what shows in the HTML
// before hydration and what any scraper reads. Prices come from lib/tickets so
// the card, /upgrade and the locker cannot quote different numbers.

type Billing = "weekly" | "monthly";

const BILLING: Record<
  Billing,
  { price: string; period: string; toggle: string; foundingLabel: string }
> = {
  weekly: {
    price: PRO_WEEKLY_PRICE_LABEL,
    period: "PER WEEK",
    toggle: "Weekly",
    foundingLabel: `First 100: ${PRO_WEEKLY_FOUNDING_PRICE_LABEL} a week, forever`,
  },
  monthly: {
    price: PRO_PRICE_LABEL,
    period: "PER MONTH",
    toggle: "Monthly",
    foundingLabel: `First 100: ${PRO_FOUNDING_PRICE_LABEL} a month, forever`,
  },
};

export default function ProPlanCard({
  perks,
  ctaHref,
  ctaLabel,
}: {
  perks: string[];
  ctaHref: string;
  ctaLabel: string;
}) {
  const [billing, setBilling] = useState<Billing>("weekly");
  const plan = BILLING[billing];

  return (
    <div className="bezel-primary flex h-full flex-col rounded-card border bg-steel p-6 text-white md:p-8">
      {/* 48px, not 44: the toggle's buttons are min-h-[44px] inside a p-0.5
          wrapper, so this row is really 48. The Free card's title row in
          app/page.tsx is pinned to the same number so the two cards' prices,
          chips and perk lists sit on identical baselines. */}
      <div className="flex min-h-[48px] flex-wrap items-center justify-between gap-3">
        <h3 className="font-athletic text-2xl font-black uppercase tracking-tight">
          Pro
        </h3>

        <div
          role="group"
          aria-label="Billing period"
          className="flex gap-1 rounded-full bg-ink/30 p-0.5"
        >
          {(Object.keys(BILLING) as Billing[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setBilling(key)}
              aria-pressed={billing === key}
              className={`inline-flex min-h-[44px] items-center rounded-full px-4 font-mono text-[10px] font-bold uppercase tracking-widest transition-colors ${
                billing === key
                  ? "bg-ink text-chalk"
                  : "text-white/60 hover:text-white"
              }`}
            >
              {BILLING[key].toggle}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-end gap-3">
        <p className="font-athletic text-5xl font-black leading-none tabular-nums">
          {plan.price}
        </p>
        <p className="pb-1 font-mono text-[10px] tracking-[0.25em] text-white/70">
          {plan.period}
        </p>
      </div>

      <p className="mt-3 text-white/85">For the serious debater.</p>

      {/* border-transparent only so this chip matches the height of the
          bordered "No card needed" chip in the Free card. */}
      <p className="mt-3 inline-flex w-fit items-center rounded-full border border-transparent bg-ink/35 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-white">
        {plan.foundingLabel}
      </p>

      <ul className="mt-6 flex-1 space-y-2.5 border-t border-white/25 pt-5">
        {perks.map((perk) => (
          <li key={perk} className="flex items-start gap-3 text-sm text-white/90">
            <span className="font-mono font-bold" aria-hidden>
              +
            </span>
            {perk}
          </li>
        ))}
      </ul>

      {/* Monthly rides along as ?period=monthly (signup keeps it, /upgrade
          opens on it; weekly is /upgrade's default). Only on a real signup
          link: the waitlist CTA is a #early-access anchor. */}
      <a
        href={billing === "monthly" && ctaHref.startsWith("/") ? `${ctaHref}&period=monthly` : ctaHref}
        className="press mt-6 rounded-card border border-transparent bg-ink px-6 py-3.5 text-center font-mono text-xs font-bold uppercase tracking-widest text-chalk transition-colors hover:bg-panel-hi"
      >
        {ctaLabel}
      </a>
    </div>
  );
}
