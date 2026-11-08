"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";
import { EVENTS, capture } from "@/lib/analytics";
import {
  WALLET_CHANGED_EVENT,
  canDebate,
  spendable,
  timeUntil,
  type Wallet,
} from "@/lib/tickets";

// The wallet chip. Lives in the dashboard header and on the new-debate page,
// which is the screen where the number actually decides something. Tapping it
// always opens /upgrade.
//
// Reads through the ticket_balance() RPC rather than selecting the columns
// directly, because the RPC accrues first: a balance read straight off the row
// can be a week stale, and showing 0 to someone who has a ticket waiting is
// the worst bug this feature can have.
//
// FOUR STATES, and the reason there are four:
//
//   loading  a skeleton, not nothing. The first version rendered null until the
//            fetch returned, which is indistinguishable from "this feature does
//            not exist" and is exactly how it read when the meter went missing.
//   unknown  the fetch failed. Shows a dash rather than vanishing, for the same
//            reason. A visible unknown is debuggable; an absent element is not.
//   low      one debate left. Warned before it is gone, not after, because the
//            moment to consider Pro is while you can still play.
//   normal   the count, plus when the next one lands.
//
// The refill line is the other half of the job. The whole model is a trickle
// that banks, and until you see "+1 in 3h" you have no way to know that, which
// makes the cap read as a wall rather than a clock.

export type TicketBalanceRow = {
  tickets: number;
  purchased: number;
  bank_cap: number;
  refill_seconds: number;
  next_ticket_at: string | null;
  is_pro: boolean;
};

export function walletFromRpc(row: TicketBalanceRow): Wallet {
  return {
    tickets: row.tickets,
    purchased: row.purchased,
    bankCap: row.bank_cap,
    refillSeconds: row.refill_seconds,
    nextTicketAt: row.next_ticket_at ? new Date(row.next_ticket_at) : null,
    isPro: row.is_pro,
  };
}

/** Shared fetcher: the RPC returns a set, so it arrives as a one-row array. */
export async function fetchWallet(): Promise<Wallet | null> {
  const { data, error } = await supabaseBrowser().rpc("ticket_balance");
  if (error || !data) return null;
  const row = (Array.isArray(data) ? data[0] : data) as
    | TicketBalanceRow
    | undefined;
  return row ? walletFromRpc(row) : null;
}

const CHIP =
  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-widest transition-colors";

function TicketIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      <path d="M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 1 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" />
    </svg>
  );
}

export default function TicketMeter({
  className = "",
  compact = false,
}: {
  className?: string;
  /**
   * Header mode. Below sm it renders the icon and the spendable number only,
   * dropping the /cap, the "TICKETS" noun and the refill line, which is what
   * keeps the 375px header inside its width budget. From sm up it is unchanged.
   */
  compact?: boolean;
}) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const w = await fetchWallet();
      if (!alive) return;
      setWallet(w);
      setStatus(w ? "ready" : "failed");
    };
    void load();
    // Focus catches the tab left open overnight; the custom event catches a
    // purchase landing in another component.
    window.addEventListener("focus", load);
    window.addEventListener(WALLET_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
      window.removeEventListener(WALLET_CHANGED_EVENT, load);
    };
  }, []);

  // In compact mode the words are hidden below sm rather than dropped from the
  // DOM, so the chip keeps one markup path and the screen-reader text stays
  // complete at every width.
  //
  // This applies to ALL FOUR states, not just the one with a number in it.
  // Measured at 375px: the header leaves this chip 72px, and the words it used
  // to print regardless of `compact` are 163px (TICKETS OFFLINE) and 155px
  // (OUT OF TICKETS / BACK IN 3H 47M). Those two states have been overflowing
  // the mobile header since compact mode was added; they were just never the
  // state anyone screenshotted. Only a glyph plus a short number fits, so every
  // state below sm renders as the icon and one thing in the number slot:
  //
  //   ready 34 · empty 0 · failed ? · loading (blank pulse)
  //
  // `sr-only sm:hidden` carries the full sentence below sm, where the visible
  // copy is display:none and therefore gone from the accessibility tree too.
  const belowSm = compact ? "hidden sm:inline" : "";
  const onlyCompact = compact ? "sm:hidden" : "hidden";

  if (status === "loading") {
    return (
      <span
        aria-hidden
        className={`${CHIP} animate-pulse border-line bg-panel text-transparent ${className}`}
      >
        <TicketIcon />
        <span className={`text-chalk-3 ${belowSm}`}>0 TICKETS</span>
      </span>
    );
  }

  if (status === "failed" || !wallet) {
    // Stated in words, not an aria-label. The old version put the only
    // explanation in a `title` (which does not exist on touch) and the only
    // machine-readable text in an aria-label on a role=generic span, where it
    // is a no-op. A visible failure is debuggable; an em dash is not.
    //
    // Below sm the words do not fit, so the balance slot holds "?" instead. A
    // question mark where a number belongs says "we do not know" without
    // needing to be read, and the blaze tone stops it reading as the loading
    // skeleton it would otherwise be identical to.
    return (
      <span
        className={`${CHIP} bg-panel ${
          compact
            ? "border-line text-chalk-3 max-sm:border-blaze/35 max-sm:text-blaze-bright"
            : "border-line text-chalk-3"
        } ${className}`}
      >
        <TicketIcon />
        <span className={belowSm}>TICKETS OFFLINE</span>
        <span className={`sr-only ${onlyCompact}`}>Tickets offline</span>
        <span aria-hidden className={onlyCompact}>
          ?
        </span>
      </span>
    );
  }

  const total = spendable(wallet);
  const empty = !canDebate(wallet);
  const low = !empty && total <= 1;
  const next = wallet.nextTicketAt;

  const tone = empty
    ? "border-blaze/50 bg-blaze/10 text-blaze-bright hover:border-blaze"
    : low
      ? "border-blaze/35 bg-panel text-blaze-bright hover:border-blaze/60"
      : "border-line bg-panel text-chalk-3 hover:border-blaze/50 hover:text-chalk";

  return (
    <Link
      // Always the store, whatever the balance. Tapping a count to reach the
      // place you top it up is the convention every game uses, and the old
      // behaviour (full balance sent you to the new-debate page) just duplicated
      // the primary CTA already sitting on both screens this chip appears on.
      href="/upgrade"
      onClick={() =>
        capture(EVENTS.UPGRADE_CLICKED, {
          surface: "ticket_meter",
          balance: total,
          was_empty: empty,
        })
      }
      className={`${CHIP} ${tone} ${className}`}
    >
      <TicketIcon />
      {empty ? (
        // The free way back in, and when. Never let a free product read as a
        // permanent lockout.
        //
        // Below sm that sentence is 155px inside a 72px slot, so it becomes a
        // blaze-toned 0 and the countdown moves to the screen the tap leads to.
        // The number is still the honest answer to "how many have I got"; it is
        // the "and when" half that does not fit on a phone header.
        <>
          <span className={belowSm}>
            {next ? `BACK ${timeUntil(next).toUpperCase()}` : "OUT OF TICKETS"}
          </span>
          <span className={`sr-only ${onlyCompact}`}>
            {next ? `No tickets. Back ${timeUntil(next)}.` : "Out of tickets."}
          </span>
          <span aria-hidden className={onlyCompact}>
            0
          </span>
        </>
      ) : (
        <>
          {/* The cap rides along, so the chip and the deck's bank cell tell the
              same story. Dropped for a pack holder, whose spendable total is
              deliberately not bounded by the allowance bank. */}
          <span>
            {total}
            {wallet.purchased === 0 && (
              <span className={`text-chalk-3 ${belowSm}`}>/{wallet.bankCap}</span>
            )}
            <span className={belowSm}>
              {" "}
              {total === 1 ? "TICKET" : "TICKETS"}
            </span>
          </span>
          {/* The trickle, made visible. Hidden at the bank cap because nothing
              is coming, and hidden for a pack holder whose count is not on a
              clock at all. */}
          {next && wallet.purchased === 0 && (
            <span className={`font-normal text-chalk-3 ${belowSm}`}>
              +1 {timeUntil(next).replace(/^in /, "")}
            </span>
          )}
        </>
      )}
    </Link>
  );
}
