import { NextResponse } from 'next/server'
import { fetchVerdictShare } from '@/lib/og'

// The topic of a SHARED verdict, for "Take the other side" (UX audit G2).
//
// A friend who opens someone's verdict from a group chat can argue the same
// topic against the AI. The new-debate page cannot read that debate itself
// (debates are RLS-scoped to their two seats), and the topic must not travel
// as a ?topic= string, because a free-text topic is the Pro custom-topic perk.
// So it travels as the debate id and is resolved here, through the same
// public read the /v/[id] page uses: a revoked, unfinished or unshared debate
// returns 404 exactly as the page does, and nothing is returned that the page
// does not already show to anyone with the link.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const share = await fetchVerdictShare(id)
  if (!share) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({
    topic: share.topic,
    side: share.userSide,
    by: share.username,
  })
}
