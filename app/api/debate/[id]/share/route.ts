import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseAdmin } from '@/lib/supabase-server'

// Share controls for one completed debate.
//
//   POST   set the visibility toggles (receipts, username). Also clears a
//          previous revoke, so "share it again" is the same button as "share".
//   DELETE revoke: /v/[id] and the card both 404 from then on.
//
// Sharing itself needs no call here. The debate UUID is the link and a finished
// verdict is public the moment it exists, which is the point: the share happens
// while the user still cares about the result. This route only ever narrows what
// is visible, or takes it down.

type Owned = {
  userId: string
  debate: { id: string; user_id: string; status: string } | null
  error: NextResponse | null
}

async function requireOwnedDebate(id: string): Promise<Owned> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { userId: '', debate: null, error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }

  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { userId: '', debate: null, error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  const { data: debate } = await supabase
    .from('debates')
    .select('id, user_id, status')
    .eq('id', id)
    .maybeSingle()

  // A row coming back is NOT proof of ownership. debates carries the
  // `debates_select_own_or_opponent` policy, so in a ranked online match the
  // CHALLENGER reads the host's row here too. Without this explicit check the
  // loser of a ranked match could revoke the winner's verdict, or strip their
  // name off a card they were proud of. Only the debate's owner decides.
  //
  // Not-yours and does-not-exist both 404 so a debate id stays unconfirmable.
  if (!debate || debate.user_id !== user.id) {
    return { userId: user.id, debate: null, error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }

  return { userId: user.id, debate, error: null }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { debate, error } = await requireOwnedDebate(id)
    if (error) return error

    // Only a judged debate has a verdict worth publishing.
    if (debate!.status !== 'complete') {
      return NextResponse.json({ error: 'This debate has not been judged yet' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({}))
    // Both default to on, matching the column defaults: an absent field means
    // "leave it public", never "quietly hide it".
    const receipts = body?.receipts !== false
    const showName = body?.name !== false

    // Service role: the share columns are deliberately absent from the
    // authenticated UPDATE grant on debates.
    const { error: writeErr } = await supabaseAdmin()
      .from('debates')
      .update({ share_receipts: receipts, share_name: showName, share_revoked: false })
      .eq('id', id)
    if (writeErr) throw writeErr

    return NextResponse.json({ ok: true, receipts, name: showName, revoked: false, v: Date.now() })
  } catch (err) {
    console.error('[debate-share POST]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not update sharing' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { error } = await requireOwnedDebate(id)
    if (error) return error

    const { error: writeErr } = await supabaseAdmin()
      .from('debates')
      .update({ share_revoked: true })
      .eq('id', id)
    if (writeErr) throw writeErr

    return NextResponse.json({ ok: true, revoked: true })
  } catch (err) {
    console.error('[debate-share DELETE]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not stop sharing' }, { status: 500 })
  }
}
