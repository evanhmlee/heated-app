// The first-run pack offer: the one time we interrupt someone who just ran out
// of debates, rather than waiting for them to find /upgrade.
//
// Any surface that discovers an empty wallet calls announceOutOfTickets(). A
// single listener (components/pack-offer.tsx, mounted once in app/layout.tsx)
// decides whether to actually show anything. That indirection exists because
// the cap is discovered in four unrelated places (the new-debate insert, lobby
// create, lobby join, the live board) and none of them should have to own a
// modal, a purchase flow, or the "have we shown this already" question.
//
// ONCE, deliberately. A paywall that reappears every time you run out is an
// app people delete. After this, the offer lives where they can find it: the
// out-of-tickets card and the ticket meter, both of which link to /upgrade.

export const OUT_OF_TICKETS_EVENT = "heated:out-of-tickets";

// localStorage, not a profile column. This is a one-time nudge, not an
// entitlement, so it does not need to survive a new device and it is not worth
// a migration plus an RPC to write (profiles has no client UPDATE grant beyond
// username and avatar_url). Worst case someone clears storage and sees it a
// second time, which costs nothing. If it ever needs to be exactly once per
// human, move it to profiles.seen_pack_offer and write it from a definer fn.
const SEEN_KEY = "heated:pack-offer-seen";

export function hasSeenPackOffer(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Safari private mode throws on localStorage. Treat it as "already seen"
    // so a storage failure can never turn into a modal on every single cap.
    return true;
  }
}

export function markPackOfferSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* see above */
  }
}

/** Fired by every surface that refuses a debate for lack of tickets. */
export function announceOutOfTickets(surface: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(OUT_OF_TICKETS_EVENT, { detail: { surface } }),
  );
}
