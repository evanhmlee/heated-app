// The ticket economy, client-safe half.
//
// The DB is the authority: public.enforce_ticket_spend() runs BEFORE INSERT on
// debates and cannot be routed around. Everything here is the friendly layer —
// showing a balance, telling someone when their next ticket lands, and stopping
// a host from opening a lobby they can never accept from.
//
// The rate table is duplicated from public.ticket_rate() in
// 20260810_ticket_economy.sql. If you change one, change both; they are asserted
// against each other by nothing but this comment.

export type TicketRate = { bankCap: number; refillSeconds: number };

export const TICKET_RATES: { free: TicketRate; pro: TicketRate } = {
  // "One free debate a week" · banks up to 3.
  free: { bankCap: 3, refillSeconds: 604_800 },
  // "3 debates a day" · banks up to 25. 8h per ticket (founder call 2026-10-12,
  // down from 5 a day; 20261012_pro_three_a_day.sql).
  pro: { bankCap: 25, refillSeconds: 28_800 },
};

// The free rate in plain words, kept beside the table because prose drifts:
// "every two days" survived in the out-of-tickets card after the rate moved to
// weekly, telling capped users the wrong thing on the one screen where they
// decide whether to pay. Anything stating the rate in a sentence reads this.
export const FREE_RATE_LABEL = "one ticket a week";
export const PRO_RATE_LABEL = "three a day";
// The same rate as a number, for lines that state it in digits.
export const PRO_DEBATES_PER_DAY = 86_400 / TICKET_RATES.pro.refillSeconds;

// Bank caps in words, derived rather than typed. "Pro banks 50" survived in the
// deck's only Pro upsell after the cap moved to 25, so the screen a free user
// sees most was overselling the plan by 2x while /upgrade said 25 on the very
// next tap. Anything stating a cap in a sentence reads these.
export const FREE_BANK_LABEL = `banks up to ${TICKET_RATES.free.bankCap}`;
export const PRO_BANK_LABEL = `Pro banks ${TICKET_RATES.pro.bankCap}`;

export const TICKETS_PER_DEBATE = 1;

// The pack. Price label lives here rather than in lib/stripe.ts because
// lib/stripe.ts is server-only and three client surfaces need to render it:
// the landing, /upgrade, and the out-of-tickets card and modal. The AMOUNT
// (in cents) still lives in lib/stripe.ts and is the only thing Stripe charges,
// so these two must be changed together.
export const PACK_SIZE = 10;
export const PACK_PRICE_LABEL = "$1.99";
// 30% off, for accounts flagged is_founding. Stripe rounds 199 * 0.7 to 139.
export const PACK_FOUNDING_PRICE_LABEL = "$1.39";

// Pro, weekly and monthly (founder call 2026-10-11: weekly replaced annual).
// Every client surface that states a Pro price reads these: the verdict's Deep
// Dive card, the Locker room's Pro card, /upgrade and the landing's plan cards.
// The AMOUNTS Stripe charges live on the Stripe prices (lib/stripe.ts looks
// them up by lookup key), so a price change means new Stripe prices AND these.
// Founder prices are 30% off, rounded the way Stripe rounds the coupon.
export const PRO_PRICE_LABEL = "$6.99"; // monthly
export const PRO_FOUNDING_PRICE_LABEL = "$4.89";
export const PRO_WEEKLY_PRICE_LABEL = "$2.99";
export const PRO_WEEKLY_FOUNDING_PRICE_LABEL = "$2.09";

export function rateFor(isPro: boolean): TicketRate {
  return isPro ? TICKET_RATES.pro : TICKET_RATES.free;
}

export type Wallet = {
  tickets: number;
  purchased: number;
  bankCap: number;
  refillSeconds: number;
  /** null when the bank is full: nothing is on the way. */
  nextTicketAt: Date | null;
  isPro: boolean;
};

/**
 * Accrual, evaluated read-only. Mirrors public.accrue_tickets() exactly,
 * including the rule that the clock advances by whole intervals rather than
 * jumping to now, so a partly-earned ticket is never discarded.
 *
 * Read-only on purpose: this runs in pre-checks and in render, and neither
 * should be able to move a balance. Only the insert trigger writes.
 */
export function walletFrom(
  row: {
    tickets: number;
    purchased_tickets: number;
    tickets_updated_at: string;
    is_pro: boolean;
  },
  now: Date = new Date(),
): Wallet {
  const { bankCap, refillSeconds } = rateFor(row.is_pro);
  const clock = new Date(row.tickets_updated_at);
  const elapsed = (now.getTime() - clock.getTime()) / 1000;
  const gained = Math.max(0, Math.floor(elapsed / refillSeconds));

  const tickets = Math.min(bankCap, row.tickets + gained);
  const advanced = new Date(clock.getTime() + gained * refillSeconds * 1000);

  return {
    tickets,
    purchased: row.purchased_tickets,
    bankCap,
    refillSeconds,
    nextTicketAt:
      tickets >= bankCap
        ? null
        : new Date(advanced.getTime() + refillSeconds * 1000),
    isPro: row.is_pro,
  };
}

/** Total spendable right now, across both pools. */
export function spendable(w: Wallet): number {
  return w.tickets + w.purchased;
}

export function canDebate(w: Wallet): boolean {
  return spendable(w) >= TICKETS_PER_DEBATE;
}

/**
 * "2d 4h" / "3h 20m" / "in a minute". Deliberately coarse: a live-ticking
 * countdown on a two-day timer is a cruel thing to put on a screen.
 */
export function timeUntil(target: Date | null, now: Date = new Date()): string {
  if (!target) return "";
  const secs = Math.max(0, Math.round((target.getTime() - now.getTime()) / 1000));
  if (secs < 60) return "in under a minute";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) {
    return remMins > 0 ? `in ${hours}h ${remMins}m` : `in ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `in ${days}d ${remHours}h` : `in ${days}d`;
}

/**
 * How far along the current refill is, 0 to 1. Drives the partially-filled pip
 * in the bank display, which is the one element that makes the trickle legible
 * at a glance: you can see a ticket arriving rather than reading a countdown.
 *
 * Returns 1 at the bank cap, where nothing is accruing and the bank is full.
 */
export function refillProgress(w: Wallet, now: Date = new Date()): number {
  if (!w.nextTicketAt) return 1;
  const secondsLeft = (w.nextTicketAt.getTime() - now.getTime()) / 1000;
  const done = (w.refillSeconds - secondsLeft) / w.refillSeconds;
  return Math.min(1, Math.max(0, done));
}

/**
 * Fired whenever something changes a wallet out of band, so the header meter
 * refreshes without a reload. Today that is exactly one caller: the
 * post-checkout confirmation, which polls until a purchase lands and then has
 * to tell a component it does not own that the number moved.
 */
export const WALLET_CHANGED_EVENT = "heated:wallet-changed";

export function announceWalletChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WALLET_CHANGED_EVENT));
}

/** The substring every client checks for. Raised by the DB trigger. */
export const OUT_OF_TICKETS = "out of tickets";

export function isOutOfTickets(message: string | null | undefined): boolean {
  return Boolean(message?.includes(OUT_OF_TICKETS));
}
