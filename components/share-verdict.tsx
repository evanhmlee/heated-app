'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import {
  cardPath,
  sharePath,
  shareTitle,
  shareBlurb,
  mailtoHref,
  smsHref,
  xHref,
  linkedInHref,
  facebookHref,
  type ShareCopy,
  type ShareFormat,
} from '@/lib/share'
import { EVENTS, capture } from '@/lib/analytics'

// Share sheet for one judged debate.
//
// Sharing is instant here: the debate UUID is the link, so the sheet opens with
// a live preview of exactly what a recipient gets, not a "create a link" step in
// front of the one moment the user actually wants to brag.
//
// Channels: on a phone the native share sheet covers group chats, email, and
// every social app in one tap, so that is the primary row. Desktop browsers
// mostly lack navigator.share, hence the explicit fallback grid. Stories are the
// exception on both: they only accept an image, so they get the 9:16 PNG (shared
// as a file where the browser supports it, downloaded where it does not).
//
// `canManage` is the owner check. In a ranked online match both seats see the
// verdict and both can send it, but only the debate's owner can change what is
// published or take it down.

type Props = {
  open: boolean
  onClose: () => void
  debateId: string
  copy: ShareCopy
  canManage?: boolean
  initialReceipts?: boolean
  initialName?: boolean
  initialRevoked?: boolean
}

// Split from the hrefs so the analytics channel key and the button label can
// never drift apart.
const CHANNEL_LABELS = {
  messages: 'Messages',
  email: 'Email',
  x: 'X',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
} as const

const PREVIEWS: { f: ShareFormat; label: string }[] = [
  { f: 'story', label: 'Story' },
  { f: 'square', label: 'Post' },
  { f: 'og', label: 'Link' },
]

export default function ShareVerdict({
  open,
  onClose,
  debateId,
  copy,
  canManage = true,
  initialReceipts = true,
  initialName = true,
  initialRevoked = false,
}: Props) {
  const [receipts, setReceipts] = useState(initialReceipts)
  const [showName, setShowName] = useState(initialName)
  const [revoked, setRevoked] = useState(initialRevoked)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [linkStashed, setLinkStashed] = useState(false)
  const [visible, setVisible] = useState(false)
  const [previewFormat, setPreviewFormat] = useState<ShareFormat>('story')
  // Preview load tracking, keyed rather than reset: comparing against the
  // current key means switching format or version implicitly goes back to
  // loading, with no effect and no stale "ready" from the previous image.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)
  const imageFileRef = useRef<File | null>(null)

  const url = typeof window !== 'undefined' ? `${window.location.origin}${sharePath(debateId)}` : ''
  // Attached to every verdict_shared. `outcome` is the one that matters: the
  // whole distribution thesis assumes people send cards they won, and if it
  // turns out losers share more the launch content should say so.
  const shareProps = {
    outcome: copy.outcome,
    receipts,
    show_name: showName,
  }
  const previewKey = `${previewFormat}-${version}`
  const previewState: 'loading' | 'ready' | 'error' =
    loadedKey === previewKey ? 'ready' : failedKey === previewKey ? 'error' : 'loading'

  // Mount as soon as `open` flips so the fade-in gets a frame, and unmount only
  // once the exit transition has run.
  //
  // This condition has to be idempotent. The obvious version guards on a
  // `wasOpen` sentinel and flips both in one shot, but React can discard the
  // render pass that queued the update, and on the retry the sentinel already
  // matches so the guard never fires again: the modal is then stuck closed
  // forever. Written this way it simply re-fires until the state sticks.
  if (open && !visible) setVisible(true)

  useEffect(() => {
    if (open) return
    const t = setTimeout(() => {
      setVisible(false)
      setError(null)
      setCopied(false)
    }, 220)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!visible) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [visible])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open) prevFocusRef.current = document.activeElement as HTMLElement
    else prevFocusRef.current?.focus?.()
  }, [open])

  useEffect(() => {
    if (open && visible) {
      const id = requestAnimationFrame(() => dialogRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [open, visible])

  // Fetch the story PNG ahead of the tap. iOS Safari treats a share as a
  // gesture-scoped action: any `await` between the tap and navigator.share()
  // drops the user activation and the call is rejected with NotAllowedError. So
  // the file has to be sitting in memory before the user touches anything, and
  // the handler has to be fully synchronous. A ref rather than state, because
  // nothing here should trigger a re-render.
  //
  // Always the story shape: that is the only image anyone posts. The link
  // preview is fetched by the platforms themselves, so there is nothing to hand
  // the user.
  useEffect(() => {
    imageFileRef.current = null
    if (revoked) return
    let cancelled = false
    fetch(cardPath(debateId, 'story', version))
      .then((r) => {
        // `res.ok` alone is not enough. fetch follows redirects, so an auth wall
        // in front of the app (Vercel's SSO on protected previews is the one
        // that bites) resolves to a 200 HTML login page. That would produce a
        // File that claims image/png while containing markup, sail through
        // canShare, and hand the OS a corrupt image with no error anywhere.
        const type = r.headers.get('content-type') ?? ''
        if (!r.ok || !type.startsWith('image/')) throw new Error('card unavailable')
        return r.blob()
      })
      .then((b) => {
        if (!cancelled) imageFileRef.current = new File([b], 'heated-verdict.png', { type: 'image/png' })
      })
      .catch(() => {
        /* the tap falls back to saving the image */
      })
    return () => {
      cancelled = true
    }
  }, [debateId, version, revoked])

  if (!visible || typeof document === 'undefined') return null

  async function save(nextReceipts: boolean, nextName: boolean) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/debate/${debateId}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ receipts: nextReceipts, name: nextName }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not update sharing')
      setRevoked(false)
      setVersion(data.v || Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update sharing')
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/debate/${debateId}/share`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not stop sharing')
      setRevoked(true)
      setCopied(false)
      setLinkStashed(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stop sharing')
    } finally {
      setBusy(false)
    }
  }

  function toggleReceipts() {
    const next = !receipts
    setReceipts(next)
    save(next, showName)
  }

  function toggleName() {
    const next = !showName
    setShowName(next)
    save(receipts, next)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      capture(EVENTS.VERDICT_SHARED, { channel: 'copy_link', ...shareProps })
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('That did not copy. Select the link and copy it yourself.')
    }
  }

  async function nativeShare() {
    try {
      capture(EVENTS.VERDICT_SHARED, { channel: 'native_link', ...shareProps })
      await navigator.share({ title: shareTitle(copy), text: shareBlurb(copy), url })
    } catch {
      // The user dismissed the sheet. Not an error worth surfacing.
    }
  }

  // Hands the image to the OS share sheet, which is how a phone posts to a story
  // or saves to the camera roll. On iOS a plain <a download> instead dumps the
  // user into Safari's file preview with an "Open in Preview" prompt.
  //
  // Deliberately NOT async and with no await before navigator.share: see the
  // prefetch effect above. Falls back to a download only where the browser
  // genuinely cannot share files, which in practice means desktop.
  function shareImage() {
    const file = imageFileRef.current
    if (!file || !navigator.canShare?.({ files: [file] })) {
      downloadImage()
      return
    }

    // `files` MUST be the only property on the payload. iOS silently degrades a
    // file share to a plain text/link share the moment `title`, `text`, or `url`
    // is present alongside it, which is exactly how this shipped: Instagram
    // offered a link instead of the card. See mdn/content#32019. Do not add a
    // title back "for context" — it costs the image.
    //
    // Order is deliberate. An Instagram story cannot carry a link on its own:
    // the poster has to add a link sticker and paste a URL into it, and now that
    // the payload is image-only the clipboard is the ONLY place the link comes
    // from. Both calls want the tap that is still in flight and only one of them
    // reliably gets it on Safari, so the share goes first and the copy is best
    // effort (the Copy button right below covers a miss).
    // Captured before the share call, never after: the handler must stay
    // synchronous up to navigator.share or iOS drops user activation.
    capture(EVENTS.VERDICT_SHARED, { channel: 'story_image', ...shareProps })
    const shared = navigator.share({ files: [file] })

    navigator.clipboard
      ?.writeText(url)
      .then(() => setLinkStashed(true))
      .catch(() => {
        /* no clipboard access; the Copy button covers it */
      })

    shared.catch(() => {
      /* dismissed, or the platform refused the file */
    })
  }

  function downloadImage() {
    capture(EVENTS.VERDICT_SHARED, { channel: 'story_download', ...shareProps })
    const a = document.createElement('a')
    a.href = cardPath(debateId, 'story', version)
    a.download = 'heated-verdict.png'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      style={{
        backgroundColor: open ? 'rgba(3,4,8,0.78)' : 'rgba(3,4,8,0)',
        transition: 'background-color 0.22s var(--ease-premium)',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share the verdict"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="bezel bezel-primary my-auto w-full max-w-lg overflow-hidden focus:outline-none"
        style={{
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.97)',
          transition: 'opacity 0.22s var(--ease-premium), transform 0.28s var(--ease-spring)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-mono text-xs font-semibold tracking-[0.25em] text-chalk">
            SHARE THE VERDICT
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-chalk-3 transition-colors hover:bg-panel-hi hover:text-chalk"
          >
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          {revoked ? (
            <div className="rounded-card border border-line bg-panel-hi/40 px-5 py-8 text-center">
              <p className="font-athletic text-xl font-black uppercase tracking-tight text-chalk">
                This one is off the board
              </p>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-chalk-3">
                The link is dead and the card no longer loads. Put it back up whenever you want.
              </p>
              {canManage && (
                <Button
                  variant="primary"
                  size="md"
                  className="mt-5"
                  disabled={busy}
                  onClick={() => save(receipts, showName)}
                >
                  {busy ? 'PUTTING IT BACK…' : 'SHARE IT AGAIN'}
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* The real card, so nothing about it is a surprise. Generated on
                  demand, and a cold start can take a few seconds on mobile data,
                  so the loading state is explicit: an empty box reads as "there
                  is no preview" rather than "it is still coming". */}
              <div className="mb-4">
                <div className="flex min-h-[190px] items-center justify-center overflow-hidden rounded-card border border-line bg-ink/60">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={previewKey}
                    src={cardPath(debateId, previewFormat, version)}
                    alt={`Preview of the ${previewFormat} card`}
                    onLoad={() => setLoadedKey(previewKey)}
                    onError={() => setFailedKey(previewKey)}
                    // Capped so the sheet still fits a phone: a full-height story
                    // card plus the toggles and every channel button runs past an
                    // iPhone viewport and pushes the buttons below the fold.
                    className={`block h-auto max-h-[38vh] w-auto max-w-full object-contain ${
                      previewState !== 'ready' ? 'hidden' : ''
                    }`}
                  />

                  {previewState === 'loading' && (
                    <div className="flex flex-col items-center gap-2 py-12">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-blaze-bright border-t-transparent" />
                      <p className="font-mono text-[10px] tracking-[0.2em] text-chalk-3">
                        BUILDING YOUR CARD…
                      </p>
                    </div>
                  )}

                  {previewState === 'error' && (
                    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                      <p className="text-xs text-chalk-3">That preview did not load.</p>
                      <button
                        type="button"
                        onClick={() => setVersion(Date.now())}
                        className="mt-1 inline-flex min-h-[44px] items-center px-4 font-mono text-[10px] font-semibold tracking-[0.2em] text-blaze-bright underline"
                      >
                        TRY AGAIN
                      </button>
                    </div>
                  )}
                </div>

                {/* Purely a preview switch. Each action below does exactly one
                    thing regardless of what is on screen. */}
                <div className="mt-3 flex items-center justify-center gap-2">
                  <span className="font-mono text-[10px] tracking-[0.2em] text-chalk-3">SHOWING</span>
                  <div className="flex gap-1 rounded-full bg-panel-hi p-0.5">
                    {PREVIEWS.map(({ f, label }) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setPreviewFormat(f)}
                        className={`flex min-h-[44px] items-center rounded-full px-4 font-mono text-[10px] font-semibold tracking-widest transition-colors ${
                          previewFormat === f
                            ? 'bg-steel text-chalk'
                            : 'text-chalk-3 hover:text-chalk'
                        }`}
                      >
                        {label.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Destination first. Each row says where it goes and does one thing. */}
              <p className="mb-2.5 font-mono text-[10px] font-semibold tracking-[0.25em] text-chalk-3">
                WHERE IS IT GOING
              </p>
              <div className="space-y-2.5">
                <ActionRow
                  onClick={shareImage}
                  title={canNativeShare ? 'Send the card as an image' : 'Download the story image'}
                  subtitle={
                    canNativeShare
                      ? // Deliberately not "post to your story". No website can
                        // post straight into an Instagram story: that needs the
                        // native Stories deep link, which is gated behind a
                        // registered Facebook app id. All the web can do is hand
                        // the OS the image and let the user pick. Promising the
                        // story and delivering a share sheet reads as broken.
                        'Opens your share sheet. Pick Instagram, Snapchat, or Save Image.'
                      : 'Saves the tall image so you can post it from your phone'
                  }
                  icon={
                    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <rect x="7" y="2" width="10" height="20" rx="2" />
                      <path d="M11 18h2" />
                    </svg>
                  }
                />
                {canNativeShare && (
                  <ActionRow
                    onClick={nativeShare}
                    title="Send the link"
                    subtitle="Group chat, Messages, WhatsApp, anywhere"
                    icon={
                      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
                        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
                      </svg>
                    }
                  />
                )}
                {canNativeShare && (
                  // The escape hatch, and on iOS often the shortest real route to
                  // a story: Instagram's share extension can drop an incoming
                  // image into the feed composer instead of Stories, whereas an
                  // image already in the camera roll always works. Cheap to keep
                  // and it means there is never a dead end.
                  <ActionRow
                    onClick={downloadImage}
                    title="Save the image"
                    subtitle="Keeps it in your camera roll to post whenever"
                    icon={
                      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    }
                  />
                )}
              </div>

              {/* Only shown once the copy actually landed, so it never claims
                  something the clipboard did not do. */}
              {linkStashed && (
                <p className="mt-2.5 text-center text-xs leading-relaxed text-blaze-bright">
                  Link copied. In your story, add a link sticker and paste it.
                </p>
              )}

              {/* On a phone the native sheet already lists every app, so these
                  would be a worse duplicate of it. Desktop has no share sheet, so
                  there they are the only way to reach a network. */}
              {!canNativeShare && (
                <>
                  <p className="mt-6 mb-2.5 font-mono text-[10px] font-semibold tracking-[0.25em] text-chalk-3">
                    OR OPEN IT IN
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {(
                      [
                        ['messages', smsHref(copy, url), false],
                        ['email', mailtoHref(copy, url), false],
                        ['x', xHref(copy, url), true],
                        ['linkedin', linkedInHref(url), true],
                        ['facebook', facebookHref(url), true],
                      ] as const
                    ).map(([channel, href, external]) => (
                      <ChannelLink
                        key={channel}
                        href={href}
                        external={external}
                        label={CHANNEL_LABELS[channel]}
                        onPick={() =>
                          capture(EVENTS.VERDICT_SHARED, { channel, ...shareProps })
                        }
                      />
                    ))}
                  </div>
                </>
              )}

              <div className="mt-5 flex items-center gap-2">
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Share link"
                  className="min-w-0 flex-1 rounded-card border border-line bg-ink/60 px-4 py-2.5 text-sm text-chalk-2"
                />
                <Button variant="secondary" size="md" onClick={copyLink} className="shrink-0">
                  {copied ? 'COPIED' : 'COPY'}
                </Button>
              </div>

              {/* Settings, not actions. Below the fold on purpose: they are the
                  rare case, and the common one is send it and move on. */}
              {canManage && (
                <div className="mt-7 border-t border-line pt-5">
                  <p className="mb-2.5 font-mono text-[10px] font-semibold tracking-[0.25em] text-chalk-3">
                    WHAT PEOPLE WILL SEE
                  </p>
                  <div className="space-y-2">
                    <Toggle
                      checked={receipts}
                      onChange={toggleReceipts}
                      disabled={busy}
                      label="Show the judge's receipts"
                      hint="The evidence the judge cited, under the note. Off leaves just the score and the note."
                    />
                    <Toggle
                      checked={showName}
                      onChange={toggleName}
                      disabled={busy}
                      label="Show my username"
                      hint="Turn this off to post it anonymously."
                    />
                  </div>

                  <button
                    type="button"
                    onClick={revoke}
                    disabled={busy}
                    className="mt-4 min-h-[44px] w-full rounded-card py-2 text-sm text-chalk-3 transition-colors hover:text-red-400 disabled:opacity-50"
                  >
                    Stop sharing this
                  </button>
                </div>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="mt-4 text-center text-sm text-red-400">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// A destination, phrased as where it goes rather than what it technically does.
function ActionRow({
  title,
  subtitle,
  icon,
  onClick,
}: {
  title: string
  subtitle: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 rounded-card border border-line px-4 py-3.5 text-left transition-colors hover:border-blaze/50 hover:bg-panel-hi"
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-steel/40 text-blaze-bright">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-chalk">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-chalk-3">{subtitle}</span>
      </span>
      <svg
        className="ml-auto flex-shrink-0 text-chalk-3"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 24 24"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean
  onChange: () => void
  label: string
  hint: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded-card border border-line px-4 py-3 text-left transition-colors ${
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-panel-hi'
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-9 flex-shrink-0 items-center rounded-full px-0.5 transition-colors duration-200 ${
          checked ? 'bg-blaze' : 'bg-chalk/15'
        }`}
      >
        <span
          className="h-4 w-4 rounded-full bg-chalk transition-transform duration-200"
          style={{ transform: checked ? 'translateX(16px)' : 'translateX(0)' }}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-chalk">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-chalk-3">{hint}</span>
      </span>
    </button>
  )
}

function ChannelLink({
  href,
  label,
  external = false,
  onPick,
}: {
  href: string
  label: string
  external?: boolean
  onPick?: () => void
}) {
  return (
    <a
      href={href}
      onClick={onPick}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="rounded-card border border-line px-3 py-2.5 text-center text-sm text-chalk-2 transition-colors hover:border-blaze/50 hover:text-chalk"
    >
      {label}
    </a>
  )
}
