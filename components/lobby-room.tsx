'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabase'
import { Button, buttonClasses } from '@/components/ui/button'
import { DIFFICULTY_META, LOBBY_TTL_MINUTES, lobbyExpired, type Difficulty } from '@/lib/debate'
import { EVENTS, capture } from '@/lib/analytics'
import { announceOutOfTickets } from '@/lib/pack-offer'
import { ArrowLeft, Check } from '@phosphor-icons/react/dist/ssr'

type Lobby = {
  id: string
  hostId: string
  code: string
  isListed: boolean
  topicSource: 'random' | 'custom'
  topicText: string | null
  hostSide: string | null
  guestSide: string | null
  difficulty: string
  turnSeconds: number
  status: string
  acceptedUserId: string | null
  debateId: string | null
  createdAt: string
}

type HostProfile = { username: string; points: number; wins: number; losses: number }

type RequestRow = {
  requesterId: string
  status: string
  username: string
  points: number
  wins: number
  losses: number
}

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// The lobby waiting room. Polls every 3s (same cadence as the rest of the
// app): the host watches the request queue, a challenger watches for the
// accept. When the lobby matches, both seats get routed into the arena.
export default function LobbyRoom({
  lobby: initialLobby,
  host,
  viewerId,
}: {
  lobby: Lobby
  host: HostProfile
  viewerId: string
}) {
  const router = useRouter()
  const isHost = initialLobby.hostId === viewerId

  const [lobby, setLobby] = useState(initialLobby)
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [myStatus, setMyStatus] = useState<string | null>(null)
  const [accepting, setAccepting] = useState<string | null>(null)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const [error, setError] = useState('')

  const expired = lobby.status === 'open' && lobbyExpired(lobby.createdAt)

  const refresh = useCallback(async () => {
    const supabase = supabaseBrowser()
    const { data: fresh } = await supabase
      .from('lobbies')
      .select('status, accepted_user_id, debate_id')
      .eq('id', initialLobby.id)
      .maybeSingle()
    if (fresh) {
      setLobby((l) => ({
        ...l,
        status: fresh.status,
        acceptedUserId: fresh.accepted_user_id,
        debateId: fresh.debate_id,
      }))
      if (
        fresh.status === 'matched' &&
        fresh.debate_id &&
        (isHost || fresh.accepted_user_id === viewerId)
      ) {
        // Online debates are created by the accept route, not by the client
        // insert on /dashboard/debate/new, so this is where the seat that is
        // about to walk into the arena records that a debate started. Both
        // seats fire their own: a ranked match consumes a ticket from each.
        capture(EVENTS.DEBATE_STARTED, {
          mode: 'online',
          format: 'speech',
          seat: isHost ? 'host' : 'guest',
        })
        router.push(`/dashboard/debate/${fresh.debate_id}`)
        return
      }
    }

    if (isHost) {
      const { data: reqs } = await supabase
        .from('lobby_requests')
        .select('requester_id, status, requester:profiles!lobby_requests_requester_id_fkey(username, points, wins, losses)')
        .eq('lobby_id', initialLobby.id)
        .order('created_at', { ascending: true })
      setRequests(
        (reqs ?? []).map((r) => {
          const p = Array.isArray(r.requester) ? r.requester[0] : r.requester
          return {
            requesterId: r.requester_id,
            status: r.status,
            username: p?.username ?? 'baller',
            points: p?.points ?? 0,
            wins: p?.wins ?? 0,
            losses: p?.losses ?? 0,
          }
        })
      )
    } else {
      const { data: mine } = await supabase
        .from('lobby_requests')
        .select('status')
        .eq('lobby_id', initialLobby.id)
        .eq('requester_id', viewerId)
        .maybeSingle()
      setMyStatus(mine?.status ?? null)
    }
  }, [initialLobby.id, isHost, viewerId, router])

  useEffect(() => {
    // Poll-driven sync with the server; the opening refresh fires immediately
    // by design (the queue/status must be fresh the moment the page mounts).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    const t = setInterval(() => void refresh(), 3000)
    return () => clearInterval(t)
  }, [refresh])

  async function accept(requesterId: string) {
    setAccepting(requesterId)
    setError('')
    try {
      const res = await fetch('/api/lobby/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lobbyId: lobby.id, requesterId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Could not accept. Try again.')
        setAccepting(null)
        void refresh()
        return
      }
      router.push(`/dashboard/debate/${data.debateId}`)
    } catch {
      setError('Could not reach the server. Try again.')
      setAccepting(null)
    }
  }

  async function decline(requesterId: string) {
    const supabase = supabaseBrowser()
    await supabase
      .from('lobby_requests')
      .update({ status: 'declined' })
      .eq('lobby_id', lobby.id)
      .eq('requester_id', requesterId)
    void refresh()
  }

  async function cancelLobby() {
    const supabase = supabaseBrowser()
    await supabase.from('lobbies').update({ status: 'cancelled' }).eq('id', lobby.id)
    router.push('/dashboard/live')
  }

  async function withdraw() {
    const supabase = supabaseBrowser()
    await supabase
      .from('lobby_requests')
      .delete()
      .eq('lobby_id', lobby.id)
      .eq('requester_id', viewerId)
    router.push('/dashboard/live')
  }

  async function requestToJoin() {
    setError('')
    const res = await fetch('/api/lobby/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lobbyId: lobby.id }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (data?.capReached) {
        capture(EVENTS.CAP_HIT, { surface: 'lobby_join', mode: 'online' })
        announceOutOfTickets('lobby_join')
      }
      setError(
        data?.capReached
          ? 'You are out of tickets. Grab a pack or wait for your next one.'
          : data?.error ?? 'Could not request to join.'
      )
      return
    }
    setMyStatus('pending')
  }

  async function copy(text: string, which: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // Clipboard needs focus/permission; the code is on screen anyway.
    }
  }

  const meta = DIFFICULTY_META[lobby.difficulty as Difficulty]
  const shareLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/dashboard/live?code=${lobby.code}`
      : ''
  const pending = requests.filter((r) => r.status === 'pending')

  return (
    <div className="relative min-h-dvh bg-ink text-chalk">
      <div className="grain" aria-hidden />

      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-athletic text-lg font-black uppercase tracking-tight"
          >
            <Image src="/logo-mark.png" alt="" width={64} height={64} className="h-14 w-14 -translate-y-1" />
            <Image src="/wordmark-red.png" alt="Heated" width={253} height={36} className="h-8 w-auto" />
          </Link>
          <Link
            href="/dashboard/live"
            className="font-mono text-xs tracking-widest text-chalk-3 hover:text-chalk"
          >
            <ArrowLeft size={13} weight="bold" aria-hidden />
            LIVE BOARD
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-14">
        <p className="font-mono text-xs tracking-[0.35em] text-blaze-bright">
          {isHost ? 'YOUR LOBBY' : `${host.username.toUpperCase()}'S LOBBY`} · RANKED · LIVE VIDEO
        </p>
        <h1 className="mt-4 font-athletic font-black uppercase leading-[0.95] tracking-tight text-[clamp(2rem,6vw,3.5rem)]">
          {lobby.topicSource === 'custom' ? lobby.topicText : 'Random matchup.'}
        </h1>
        <p className="mt-3 font-mono text-[11px] tracking-[0.2em] text-chalk-3">
          {lobby.topicSource === 'custom' ? (
            <>
              {host.username.toUpperCase()}: {(lobby.hostSide ?? '').toUpperCase()} · CHALLENGER:{' '}
              {(lobby.guestSide ?? '').toUpperCase()}
            </>
          ) : (
            <>
              {meta?.label ?? 'STARTER'} DEPTH · TOPIC REVEALED AT TIP-OFF · SIDES FLIPPED
            </>
          )}
          {' · '}
          {fmtClock(lobby.turnSeconds)} TURNS
        </p>

        {lobby.status === 'cancelled' ? (
          <div className="bezel mt-10 p-8 text-center">
            <p className="font-athletic text-2xl font-black uppercase tracking-tight">
              This lobby was closed.
            </p>
            <Link href="/dashboard/live" className={buttonClasses('secondary', 'md', 'mt-6')}>
              BACK TO THE BOARD
            </Link>
          </div>
        ) : expired ? (
          <div className="bezel mt-10 p-8 text-center">
            <p className="font-athletic text-2xl font-black uppercase tracking-tight">
              This lobby expired.
            </p>
            <p className="mt-2 text-sm text-chalk-3">
              Lobbies close after {LOBBY_TTL_MINUTES} minutes without a match.
            </p>
            {isHost ? (
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link
                  href="/dashboard/debate/new?opponent=online"
                  className={buttonClasses('primary', 'md')}
                >
                  OPEN A FRESH ONE
                </Link>
                <Button type="button" variant="ghost" onClick={() => void cancelLobby()}>
                  CLOSE IT OUT
                </Button>
              </div>
            ) : (
              <Link href="/dashboard/live" className={buttonClasses('secondary', 'md', 'mt-6')}>
                BACK TO THE BOARD
              </Link>
            )}
          </div>
        ) : isHost ? (
          <>
            {/* Share card */}
            <div className="bezel bezel-primary mt-10 p-6 md:p-8">
              <p className="font-mono text-[10px] tracking-[0.3em] text-chalk-3">
                INVITE CODE {lobby.isListed ? '· ALSO LISTED ON THE LIVE BOARD' : '· UNLISTED, CODE ONLY'}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <p className="font-athletic text-4xl font-black tracking-[0.2em] text-blaze-bright md:text-5xl">
                  {lobby.code}
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => void copy(lobby.code, 'code')}>
                    {copied === 'code' ? <><Check size={13} weight="bold" aria-hidden />COPIED</> : 'COPY CODE'}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => void copy(shareLink, 'link')}>
                    {copied === 'link' ? <><Check size={13} weight="bold" aria-hidden />COPIED</> : 'COPY LINK'}
                  </Button>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-chalk-3">
                Send it to somebody with a take. When they request in, you accept
                one challenger and the arena opens: live video, {fmtClock(lobby.turnSeconds)} a
                turn, winner takes the points.
              </p>
            </div>

            {/* Request queue */}
            <div className="mt-10">
              <div className="flex items-baseline justify-between gap-4">
                <p className="font-mono text-xs tracking-[0.3em] text-chalk-3">CHALLENGERS</p>
                <p className="font-mono text-[11px] tracking-widest text-chalk-3 tabular-nums">
                  {pending.length} WAITING
                </p>
              </div>
              {pending.length === 0 ? (
                <div className="mt-4 rounded-card border border-dashed border-line bg-panel/40 px-6 py-10 text-center">
                  <p className="font-mono text-[11px] tracking-[0.3em] text-chalk-3 animate-pulse">
                    WAITING FOR SOMEBODY TO STEP UP…
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {pending.map((r) => (
                    <div key={r.requesterId} className="bezel flex flex-wrap items-center gap-4 px-6 py-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-chalk">{r.username}</p>
                        <p className="mt-0.5 font-mono text-[10px] tracking-[0.2em] text-chalk-3">
                          {r.points.toLocaleString()} PTS · {r.wins}–{r.losses}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={accepting !== null}
                          onClick={() => void accept(r.requesterId)}
                        >
                          {accepting === r.requesterId ? 'OPENING…' : 'ACCEPT'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={accepting !== null}
                          onClick={() => void decline(r.requesterId)}
                        >
                          DECLINE
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-10 border-t border-line pt-6">
              <Button type="button" variant="ghost" onClick={() => void cancelLobby()}>
                CLOSE THE LOBBY
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Challenger view */}
            <div className="bezel mt-10 flex flex-wrap items-center gap-4 px-6 py-5">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] tracking-[0.3em] text-chalk-3">THE HOST</p>
                <p className="mt-1 truncate font-semibold text-chalk">{host.username}</p>
                <p className="mt-0.5 font-mono text-[10px] tracking-[0.2em] text-chalk-3">
                  {host.points.toLocaleString()} PTS · {host.wins}–{host.losses}
                </p>
              </div>
            </div>

            <div className="bezel bezel-primary mt-6 p-8 text-center">
              {myStatus === 'pending' ? (
                <>
                  <p className="font-mono text-[11px] tracking-[0.3em] text-blaze-bright animate-pulse">
                    REQUEST SENT · WAITING ON THE HOST
                  </p>
                  <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-chalk-3">
                    Keep this page open. The second {host.username} accepts, the
                    arena opens and the coin flip decides who leads.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void withdraw()}
                    className="mt-6"
                  >
                    WITHDRAW REQUEST
                  </Button>
                </>
              ) : myStatus === 'declined' ? (
                <>
                  <p className="font-athletic text-2xl font-black uppercase tracking-tight">
                    The host passed on this one.
                  </p>
                  <p className="mt-2 text-sm text-chalk-3">
                    Nothing personal. Plenty of other lobbies on the board.
                  </p>
                  <Link href="/dashboard/live" className={buttonClasses('secondary', 'md', 'mt-6')}>
                    BACK TO THE BOARD
                  </Link>
                </>
              ) : (
                <>
                  <p className="font-athletic text-2xl font-black uppercase tracking-tight">
                    Step into the arena.
                  </p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-chalk-3">
                    Live video debate, {fmtClock(lobby.turnSeconds)} a turn, AI
                    judge, points on the line. The host picks who gets the shot.
                  </p>
                  <Button type="button" size="lg" onClick={() => void requestToJoin()} className="mt-6">
                    REQUEST TO JOIN
                  </Button>
                </>
              )}
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="mt-6 text-sm text-red-400">
            {error}
          </p>
        )}
      </main>
    </div>
  )
}
