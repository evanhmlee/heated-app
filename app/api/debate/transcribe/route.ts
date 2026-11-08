import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const maxDuration = 60

const AAI = 'https://api.assemblyai.com/v2'

// Speech rounds are short (2:00 cap at 32kbps ≈ 500KB), so the audio comes
// straight through this route to AssemblyAI's upload endpoint — no R2 bucket
// needed, unlike pitchcoach's 1GB uploads. Hard reject anything over 4MB
// (Vercel body limit is 4.5MB).
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

// POST: audio blob (FormData "audio") → AssemblyAI upload + transcript create.
// Returns { transcriptId } immediately; client polls the GET below.
export async function POST(request: Request) {
  try {
    const supabase = await supabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const form = await request.formData()
    const audio = form.get('audio')
    if (!(audio instanceof Blob) || audio.size === 0) {
      return NextResponse.json({ error: 'audio file required' }, { status: 400 })
    }
    if (audio.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'recording too large' }, { status: 413 })
    }

    const apiKey = process.env.ASSEMBLYAI_API_KEY!
    const uploadRes = await fetch(`${AAI}/upload`, {
      method: 'POST',
      headers: { authorization: apiKey },
      body: Buffer.from(await audio.arrayBuffer()),
    })
    if (!uploadRes.ok) {
      console.error('assemblyai upload failed', uploadRes.status, await uploadRes.text())
      return NextResponse.json({ error: 'upload failed' }, { status: 502 })
    }
    const { upload_url } = await uploadRes.json()

    const createRes = await fetch(`${AAI}/transcript`, {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ audio_url: upload_url, speech_models: ['universal-3-pro', 'universal-2'] }),
    })
    if (!createRes.ok) {
      console.error('assemblyai create failed', createRes.status, await createRes.text())
      return NextResponse.json({ error: 'transcription request failed' }, { status: 502 })
    }
    const transcript = await createRes.json()

    return NextResponse.json({ transcriptId: transcript.id })
  } catch (err) {
    console.error('transcribe POST error', err)
    return NextResponse.json({ error: 'transcription failed' }, { status: 500 })
  }
}

// GET ?id=<transcriptId>: poll status. Returns { status, text? }.
export async function GET(request: Request) {
  try {
    const supabase = await supabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const res = await fetch(`${AAI}/transcript/${id}`, {
      headers: { authorization: process.env.ASSEMBLYAI_API_KEY! },
    })
    if (!res.ok) {
      return NextResponse.json({ error: 'poll failed' }, { status: 502 })
    }
    const data = await res.json()

    if (data.status === 'completed') {
      return NextResponse.json({ status: 'completed', text: data.text ?? '' })
    }
    if (data.status === 'error') {
      return NextResponse.json({ status: 'error', error: data.error })
    }
    return NextResponse.json({ status: data.status })
  } catch (err) {
    console.error('transcribe GET error', err)
    return NextResponse.json({ error: 'poll failed' }, { status: 500 })
  }
}
