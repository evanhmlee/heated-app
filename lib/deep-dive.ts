import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Verdict } from '@/lib/debate'

// The Deep Dive's prose is a Pro perk, so it never lives in debates.verdict.
// Both seats can SELECT their debate row, and every client path reads it (the
// ranked arena polls it and listens for it), so stripping the text in our
// routes was a paywall a free player beat by reading the row from the browser.
// The prose sits in public.debate_deep_dives, which has RLS on and no policies:
// only the service role reads it, and only for an effective-Pro caller
// (is_pro, or holding pack tickets, same rule as public.is_effective_pro()).
// debates.verdict keeps each entry's round and swing, which the locked teaser
// needs ("You won it in the rebuttal").

export function isDeepDiveUnlocked(p: { is_pro?: boolean | null; purchased_tickets?: number | null } | null): boolean {
  return Boolean(p?.is_pro) || (p?.purchased_tickets ?? 0) > 0
}

/** The verdict as stored: rounds and swing kept, prose removed. */
export function stripDeepDive(v: Verdict): Verdict {
  if (!v.deep_dive?.length) return v
  return { ...v, deep_dive: v.deep_dive.map((e) => ({ ...e, verdict: '' })) }
}

/** Saves the prose. A second judge call racing the first is a no-op. */
export async function saveDeepDive(admin: SupabaseClient, debateId: string, v: Verdict): Promise<void> {
  if (!v.deep_dive?.length) return
  const { error } = await admin
    .from('debate_deep_dives')
    .upsert({ debate_id: debateId, entries: v.deep_dive }, { onConflict: 'debate_id', ignoreDuplicates: true })
  if (error) console.error('deep dive save failed', error)
}

/** The stored verdict with its prose put back, for an unlocked caller only. */
export async function withDeepDive(admin: SupabaseClient, debateId: string, v: Verdict): Promise<Verdict> {
  if (!v.deep_dive?.length) return v
  const { data } = await admin
    .from('debate_deep_dives')
    .select('entries')
    .eq('debate_id', debateId)
    .maybeSingle()
  return data?.entries ? { ...v, deep_dive: data.entries as Verdict['deep_dive'] } : v
}
