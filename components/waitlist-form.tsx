"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase";
import { EVENTS, capture, setPersonProperties } from "@/lib/analytics";

// Pre-launch waitlist. Inserts the email into public.waitlist (anon insert is
// allowed by RLS; the list is not readable from the client). A duplicate email
// (unique violation, 23505) is treated as success — you're already in.
export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle"
  );
  const [copied, setCopied] = useState(false);
  // The visitor's spot in line, shown only once 50+ spots are claimed (same
  // gate as the founder counter: a low number reads as an empty room).
  const [spot, setSpot] = useState<number | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) return;
    setStatus("loading");
    const normalized = email.trim().toLowerCase();
    const { error } = await supabaseBrowser()
      .from("waitlist")
      .insert({ email: normalized, source: "landing" });
    // 23505 = unique violation → already on the list, still a win.
    if (error && error.code !== "23505") {
      setStatus("error");
      return;
    }
    setStatus("done");
    // Makes the signup a person in PostHog, matchable to the waitlist row.
    setPersonProperties({ email: normalized, on_waitlist: true });
    // `already_on_list` distinguishes a new email from a repeat submit, so the
    // waitlist funnel isn't inflated by people who hit the form twice.
    capture(EVENTS.WAITLIST_JOINED, {
      source: "landing",
      already_on_list: Boolean(error),
    });
    // Fresh (cache-busted) count = this signup's spot number. Duplicates
    // skip it: the current count is not their position. Best-effort only.
    if (!error) {
      try {
        const r = await fetch(`/api/waitlist/count?t=${Date.now()}`);
        const d = r.ok ? await r.json() : null;
        if (d && typeof d.count === "number" && d.count >= 50) {
          setSpot(d.count);
        }
      } catch {
        // no spot number; the generic success copy still shows
      }
    }
  }

  // Post-signup share: the visitor who just locked in is mid-argument with
  // someone, so hand them the link while the energy is hot. Native share
  // sheet on mobile, clipboard fallback on desktop.
  async function handleShare() {
    const url = window.location.origin;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Heated",
          text: "Settle it here. AI judge, real NBA stats.",
          url,
        });
        return;
      } catch {
        // user dismissed the sheet; nothing else to do
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable; leave the button as-is
    }
  }

  return (
    <form
      className="mx-auto flex w-full max-w-md flex-col gap-3 sm:flex-row"
      onSubmit={handleSubmit}
    >
      <div aria-live="polite" className="contents">
        {status === "done" ? (
          <div className="flex w-full flex-col gap-3">
            <p className="w-full rounded-card border border-blaze/40 bg-panel px-5 py-4 text-center font-mono text-sm tracking-wide text-blaze-bright">
              {spot !== null && spot <= 100
                ? `YOU'RE #${spot} OF THE FIRST 100. FOUNDER STATUS LOCKED.`
                : spot !== null
                  ? `YOU'RE #${spot} IN LINE. FIRST IN WHEN DOORS OPEN.`
                  : "YOU'RE ON THE LIST. FIRST IN WHEN DOORS OPEN."}
            </p>
            <button
              type="button"
              onClick={handleShare}
              className="w-full rounded-card border border-line bg-panel px-5 py-3.5 text-center font-mono text-xs font-bold uppercase tracking-widest text-chalk/80 transition-colors hover:border-blaze/50 hover:text-chalk"
            >
              {copied ? "LINK COPIED." : "SEND IT TO THE GROUP CHAT"}
            </button>
          </div>
        ) : (
          <>
            <div className="flex w-full flex-col gap-2">
              <input
                type="email"
                name="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Email address"
                autoComplete="email"
                spellCheck={false}
                placeholder="YOUR@EMAIL.COM"
                className="w-full rounded-card border border-line bg-panel px-5 py-4 font-mono text-sm tracking-wide text-chalk placeholder:text-chalk/40 focus:border-blaze focus:outline-none focus-visible:outline-2 focus-visible:outline-blaze-bright"
              />
              {status === "error" && (
                <p className="font-mono text-[11px] tracking-wide text-blaze-bright">
                  SOMETHING BROKE. TRY AGAIN IN A SEC.
                </p>
              )}
            </div>
            <Button
              type="submit"
              size="lg"
              className="shrink-0"
              disabled={status === "loading"}
            >
              {status === "loading" ? "LOCKING IN..." : "LOCK ME IN"}
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
