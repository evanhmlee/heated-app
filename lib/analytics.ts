// Event names, in one place, so a capture call and a PostHog insight can never
// disagree about spelling. Client-safe: no node imports, and the only env read
// is the public PostHog key below.
//
// The load-bearing one is CAP_HIT. It is the numerator of the whole conversion
// model: how many people run out of tickets is the only evidence that the
// allowance is binding, and without it there is no way to tell whether a
// pricing change did anything. Every path that refuses a debate for lack of
// tickets fires it, including the server-side refusals.

// Your PostHog project key (a public phc_ key). Unset or "" = analytics off,
// and every capture call quietly does nothing.
// Shared by the browser provider and the server-side webhook capture.
export function posthogKey(): string | undefined {
  return process.env.NEXT_PUBLIC_POSTHOG_KEY || undefined;
}

export const EVENTS = {
  // ── Acquisition ──────────────────────────────────────────────
  WAITLIST_JOINED: "waitlist_joined",
  SIGNED_UP: "signed_up",
  // The 6-digit code was accepted (method: code), or the email link signed
  // this browser in while the code screen was open (method: link).
  SIGNUP_VERIFIED: "signup_verified",
  PASSWORD_RESET: "password_reset",
  IN_APP_LINK_COPIED: "in_app_link_copied",

  // ── Core loop ────────────────────────────────────────────────
  DEBATE_STARTED: "debate_started",
  DEBATE_COMPLETED: "debate_completed",
  VERDICT_VIEWED: "verdict_viewed",
  VERDICT_SHARED: "verdict_shared",
  DAILY_ATTEMPT_SUBMITTED: "daily_attempt_submitted",

  // ── Monetization ─────────────────────────────────────────────
  CAP_HIT: "cap_hit",
  PACK_OFFER_SHOWN: "pack_offer_shown",
  UPGRADE_CLICKED: "upgrade_clicked",
  CHECKOUT_STARTED: "checkout_started",
  SUBSCRIPTION_STARTED: "subscription_started",
  PACK_PURCHASED: "pack_purchased",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

// Where a debate was set up from, so cap_hit and debate_started can be sliced
// the same way. Mirrors the opponent step on /dashboard/debate/new.
export type DebateMode = "ai" | "same_device" | "online";

// posthog-js does NOT queue before init: capture() checks __loaded, logs
// "You must initialize PostHog before calling posthog.capture", and drops the
// event. Init runs in app/providers.tsx after hydration, so anything fired
// before that lands in the gap. CAP_HIT is the numerator of the whole conversion
// model, so losing it silently is the one failure this file exists to prevent:
// hold calls here instead and let providers replay them on init.
//
// Bounded because a page with no key set (local dev, a preview without env)
// never flushes, and an unbounded array would just grow for the whole session.
type PostHogClient = (typeof import("posthog-js"))["default"];
const MAX_QUEUED = 100;
let queued: Array<(ph: PostHogClient) => void> = [];

export function flushCaptureQueue(): void {
  if (!queued.length) return;
  const pending = queued;
  queued = [];
  void import("posthog-js").then(({ default: posthog }) => {
    for (const run of pending) run(posthog);
  });
}

// Fire and forget. Analytics must never be able to break the thing it is
// measuring, so every call goes through here and swallows.
function withPostHog(run: (ph: PostHogClient) => void): void {
  if (typeof window === "undefined") return;
  try {
    // Imported lazily: pulling posthog-js into a server component's module
    // graph costs a bundle it never uses.
    void import("posthog-js").then(({ default: posthog }) => {
      if (posthog.__loaded) {
        run(posthog);
      } else if (queued.length < MAX_QUEUED) {
        queued.push(run);
      }
    });
  } catch {
    /* analytics is never load-bearing */
  }
}

export function capture(
  event: EventName,
  props?: Record<string, unknown>,
): void {
  withPostHog((ph) => ph.capture(event, props));
}

// The project runs identified-only person profiles, so an anonymous visitor
// never becomes a person. Setting properties opts this visitor in, which is
// what turns a waitlist signup into a findable person. When they later sign
// up, identify() merges this anonymous person into the account.
export function setPersonProperties(props: Record<string, unknown>): void {
  withPostHog((ph) => ph.setPersonProperties(props));
}
