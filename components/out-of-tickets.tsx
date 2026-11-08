"use client";

import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EVENTS, capture } from "@/lib/analytics";
import {
  PACK_PRICE_LABEL,
  PACK_SIZE,
  FREE_BANK_LABEL,
  FREE_RATE_LABEL,
  PRO_BANK_LABEL,
  PRO_RATE_LABEL,
  timeUntil,
  type Wallet,
} from "@/lib/tickets";

// The cap screen. Shown wherever a debate is refused for lack of tickets.
//
// Three things, in this order, because that is the order they matter in:
//   1. That this is temporary. The timing sits in the BODY rather than the
//      headline: at 48h "Next one lands in 2d" genuinely reassured, but the
//      free rate is a week now, and a seven-day countdown set as the largest
//      text on the screen argues for closing the app rather than staying.
//      Still first thing in the paragraph, because nobody should think they
//      are permanently locked out of a free product.
//   2. A pack, which is the impulse buy and the thing a real person actually
//      taps in a heated moment. It is listed above Pro on purpose.
//   3. Pro, for the person doing this every day.
//
// This is also the only screen in the app where cap_hit converts, so both CTAs
// carry the surface they were tapped from.

export default function OutOfTickets({
  wallet,
  surface,
}: {
  wallet: Wallet | null;
  surface: string;
}) {
  const next = wallet?.nextTicketAt ?? null;

  return (
    <div className="bezel bezel-primary mt-10 p-8 md:p-10">
      <p className="font-mono text-xs tracking-[0.3em] text-blaze-bright">
        OUT OF TICKETS
      </p>
      <h2 className="mt-3 font-athletic text-3xl font-black uppercase tracking-tight">
        You are all out.
      </h2>

      <p className="mt-3 max-w-lg leading-relaxed text-chalk-3">
        {next ? `Your next free ticket lands ${timeUntil(next)}. ` : ""}
        {wallet?.isPro
          ? `${PRO_BANK_LABEL} tickets and refills ${PRO_RATE_LABEL}, so this is a hard day of arguing. Grab a pack if you are not done.`
          : `Free gets ${FREE_RATE_LABEL} and ${FREE_BANK_LABEL}. Pro runs ${PRO_RATE_LABEL}.`}
      </p>

      <div className="mt-7 flex flex-wrap gap-3">
        <Link
          href="/upgrade?view=pack"
          onClick={() =>
            capture(EVENTS.UPGRADE_CLICKED, { surface, intent: "pack" })
          }
          className={buttonClasses("primary", "lg")}
        >
          {`GET ${PACK_SIZE} FOR ${PACK_PRICE_LABEL}`}
        </Link>
        {!wallet?.isPro && (
          <Link
            href="/upgrade"
            onClick={() =>
              capture(EVENTS.UPGRADE_CLICKED, { surface, intent: "pro" })
            }
            className={buttonClasses("secondary", "lg")}
          >
            GO PRO
          </Link>
        )}
      </div>

      <p className="mt-4 text-sm text-chalk-3">
        Packs are a one-off. No subscription, and they come with Pro turned on
        while they last.
      </p>
    </div>
  );
}
