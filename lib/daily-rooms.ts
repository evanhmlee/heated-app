// Server-only Daily.co REST helpers for online ranked H2H debates.
//
// Daily hosts the live video/audio call (free tier: 10,000 participant-
// minutes/month — plenty pre-revenue). One private room per debate, created at
// match acceptance; both players get per-user meeting tokens (the room is
// private, so a leaked URL is useless without one). The call is live-only:
// nothing is recorded or stored — per-turn mic audio goes through the existing
// AssemblyAI transcribe route exactly like the same-device arena.
//
// Env: DAILY_API_KEY (dashboard.daily.co → Developers). Read per-call, never at
// module level (Vercel build-time crash guardrail, same rule as Stripe in
// pitchcoach). Every helper throws a clear error when the key is missing.

const DAILY_API = 'https://api.daily.co/v1'

// Rooms outlive the longest possible match by a wide margin (a 2:00-turn
// debate runs ~16 minutes), then self-destruct: 3 hours.
export const ROOM_TTL_SECONDS = 3 * 60 * 60

function apiKey(): string {
  const key = process.env.DAILY_API_KEY
  if (!key) {
    throw new Error(
      'DAILY_API_KEY is not set. Create a free Daily.co account and add the API key to the environment.'
    )
  }
  return key
}

async function dailyFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${DAILY_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
}

// Daily room names allow [A-Za-z0-9_-] with a modest length cap, so use a
// dash-stripped uuid prefix (24 hex chars of a v4 uuid — collision-proof for
// our volumes) rather than the raw 36-char uuid.
export function roomNameFor(debateId: string): string {
  return `heated-${debateId.replace(/-/g, '').slice(0, 24)}`
}

export function roomNameFromUrl(roomUrl: string): string {
  return new URL(roomUrl).pathname.replace(/^\//, '')
}

export async function createRoom(debateId: string): Promise<{ name: string; url: string }> {
  const res = await dailyFetch('/rooms', {
    method: 'POST',
    body: JSON.stringify({
      name: roomNameFor(debateId),
      privacy: 'private',
      properties: {
        exp: Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS,
        eject_at_room_exp: true,
        enable_screenshare: false,
        enable_chat: false,
        enable_knocking: false,
        enable_recording: false,
        start_video_off: false,
        start_audio_off: false,
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Daily room creation failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as { name: string; url: string }
  return { name: data.name, url: data.url }
}

// Per-user token for a private room. `userId` (the supabase uid) is what the
// presence endpoint echoes back, which is how the abandon route verifies a
// specific player actually left instead of trusting the claimant.
export async function createMeetingToken(
  roomName: string,
  userId: string,
  userName: string
): Promise<string> {
  const res = await dailyFetch('/meeting-tokens', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_id: userId,
        user_name: userName,
        exp: Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS,
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Daily token creation failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as { token: string }
  return data.token
}

// Who is in the room RIGHT NOW (userIds from the meeting tokens).
export async function getRoomPresence(roomName: string): Promise<{ userIds: string[]; count: number }> {
  const res = await dailyFetch(`/rooms/${encodeURIComponent(roomName)}/presence`)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Daily presence check failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    total_count: number
    data?: { userId?: string | null }[]
  }
  return {
    count: data.total_count ?? 0,
    userIds: (data.data ?? []).map((p) => p.userId).filter((u): u is string => Boolean(u)),
  }
}

// Best-effort cleanup once a match finishes (rooms self-expire anyway).
export async function deleteRoom(roomName: string): Promise<void> {
  try {
    await dailyFetch(`/rooms/${encodeURIComponent(roomName)}`, { method: 'DELETE' })
  } catch {
    // Room expiry is the backstop; a failed delete is not worth surfacing.
  }
}
