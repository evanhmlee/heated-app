"use client";

import { useEffect, useSyncExternalStore, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react";
import { supabaseBrowser } from "@/lib/supabase";
import { flushCaptureQueue, posthogKey } from "@/lib/analytics";

// Analytics provider, ported from pitchcoachai/app/providers.tsx.
//
// Deliberately simpler than PitchCoach's: no consent gate and no TikTok pixel,
// because this app has neither a cookie banner nor a pixel today. Traffic is
// US-facing; before any EU push this needs PitchCoach's region cookie + stored
// consent check, which is the whole reason that file is shaped the way it is.
//
// Session replay stays off (house standard, and a debate arena holds a live
// camera feed). capture_exceptions is on, which is also the error tracking:
// there is no Sentry in this project either.

// posthog-js drops any capture/identify made before init and logs "You must
// initialize PostHog before calling posthog.capture" to the console. Init runs
// in an effect, so a child's mount-time $pageview or identify can still beat
// it. Pageviews and identify gate on usePostHogReady(); everything routed
// through lib/analytics capture() is replayed by flushCaptureQueue().
let phReady = false;
const readyWaiters = new Set<() => void>();

function markReady() {
  if (phReady) return;
  phReady = true;
  readyWaiters.forEach((notify) => notify());
  readyWaiters.clear();
  flushCaptureQueue();
}

// Subscription to an external mutable flag, so useSyncExternalStore rather than
// useState + useEffect. The effect version set state from inside an effect,
// which react-hooks/set-state-in-effect rejects and which double-renders every
// consumer on init. phReady only ever goes false to true once, so the store
// never needs to notify twice. The server snapshot is false because PostHog
// only exists in the browser.
function subscribeReady(notify: () => void) {
  readyWaiters.add(notify);
  return () => {
    readyWaiters.delete(notify);
  };
}

function usePostHogReady() {
  return useSyncExternalStore(
    subscribeReady,
    () => phReady,
    () => false
  );
}

function initPostHog() {
  // Falls back to the committed project key: Vercel will not save the env var.
  const key = posthogKey();
  // __loaded is set by posthog-js after init; re-initing throws a console
  // error and resets the queue (React strict mode mounts effects twice).
  if (posthog.__loaded) {
    markReady();
    return;
  }
  if (!key) return;
  posthog.init(key, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2025-05-24",
    capture_pageview: false,
    capture_pageleave: true,
    capture_exceptions: true,
    disable_session_recording: true,
    // Send each event as it happens instead of flushing a batch every few
    // seconds. The landing sees a handful of events per visit, and a visitor
    // from a social in-app browser often closes it before a batch would go.
    request_batching: false,
  });
  markReady();
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Straight on mount, not deferred to browser idle. Measured on production
    // (2026-09-12): the landing loaded in 0.8s but the idle callback only fired
    // on its 3s timeout, so the first pageview went out ~7s in and anyone who
    // bounced sooner was never counted. The arenas only touch getUserMedia
    // after a tap, so they never competed with this.
    initPostHog();
  }, []);

  return (
    <PHProvider client={posthog}>
      <SuspendedPageView />
      <AuthIdentify />
      {children}
    </PHProvider>
  );
}

// ─── Manual pageviews (App Router fires no route events) ──────────────
function PageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();
  const ready = usePostHogReady();

  useEffect(() => {
    if (!pathname || !ph || !ready) return;
    let url = window.origin + pathname;
    const search = searchParams.toString();
    if (search) url += "?" + search;
    ph.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams, ph, ready]);

  return null;
}

// useSearchParams must sit under Suspense or it de-opts the whole tree to
// client-side rendering.
function SuspendedPageView() {
  return (
    <Suspense fallback={null}>
      <PageView />
    </Suspense>
  );
}

// ─── Tie the PostHog person to the Supabase user ──────────────────────
function AuthIdentify() {
  const ph = usePostHog();
  const ready = usePostHogReady();

  useEffect(() => {
    if (!ph || !ready) return;
    const supabase = supabaseBrowser();

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) ph.identify(user.id, { email: user.email });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        ph.identify(session.user.id, { email: session.user.email });
      } else if (event === "SIGNED_OUT") {
        ph.reset();
      }
    });

    return () => subscription.unsubscribe();
  }, [ph, ready]);

  return null;
}
