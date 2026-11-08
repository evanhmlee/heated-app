"use client";

import { useEffect, useRef } from "react";
import { EVENTS, capture } from "@/lib/analytics";

// Fires verdict_viewed once when a public verdict permalink renders.
//
// /v/[id] is a server component, so there is nowhere in it to capture from.
// This is the other half of verdict_shared: shares tell you cards left the
// building, views tell you anyone opened them, and the ratio between the two is
// the only real measure of whether the group-chat loop works. PitchCoach shipped
// the same share card and it produced no distribution; this is how we find out
// whether that repeats before spending three months on it.
//
// Deliberately fires for signed-out visitors too (that is the whole point), and
// the ref guards React 19 StrictMode's double effect in dev.
export default function ViewBeacon({
  debateId,
  hasReceipts,
}: {
  debateId: string;
  hasReceipts: boolean;
}) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    capture(EVENTS.VERDICT_VIEWED, {
      debate_id: debateId,
      has_receipts: hasReceipts,
    });
  }, [debateId, hasReceipts]);

  return null;
}
