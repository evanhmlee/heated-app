'use client'

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { EVENTS, capture } from '@/lib/analytics'
import { detectInAppBrowser, systemBrowserName, type InAppBrowser } from '@/lib/in-app-browser'
import {
  CODE_LENGTH,
  RESEND_COOLDOWN_SECONDS,
  cleanCode,
  codeErrorMessage,
  inboxFor,
  passwordStrengthError,
  safeNextPath,
  secondsUntilRetry,
  signinErrorMessage,
  signupErrorMessage,
  usernameError,
} from '@/lib/auth-copy'

// Sign in, sign up, and getting back in, on one page (UX audit B, 2026-10-10).
//
// Signup confirms with a 6-digit code typed in THIS tab. It used to send a
// link, and a link opened from the mail app lands in Safari or Chrome, not in
// the TikTok or Instagram browser the signup started in, so the person arrived
// signed out somewhere else. The email still carries the link (it needs
// {{ .Token }} added to the Supabase "Confirm signup" template for the code),
// and if the link signs this browser in, the code screen moves on by itself.
//
// "Forgot password?" is new too. Email and password is the only way in, so a
// forgotten password used to lose the account, its points and any Pro plan.
// Same code approach (the "Reset Password" template needs {{ .Token }}); a
// clicked link goes through /auth/callback to /auth/reset instead.
//
// `next` rides through every path, so a friend who opens a lobby invite or a
// shared verdict and has to sign in first lands back where they started.

type View = 'signin' | 'signup' | 'code' | 'forgot' | 'reset'
type Pending = { email: string; sentAt: number; kind: 'signup' | 'recovery' }

// sessionStorage, so the code screen survives the page reloading while the
// person is in their mail app, and is gone when the tab closes.
const PENDING_KEY = 'heated:authPending'

function readPending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    return raw ? (JSON.parse(raw) as Pending) : null
  } catch {
    return null
  }
}

function writePending(p: Pending | null) {
  try {
    if (p) sessionStorage.setItem(PENDING_KEY, JSON.stringify(p))
    else sessionStorage.removeItem(PENDING_KEY)
  } catch {
    // Private mode: the flow still works, it just will not survive a reload.
  }
}

const inputClass =
  'w-full rounded-card border border-line-strong bg-ink px-4 py-3.5 text-chalk placeholder:text-chalk-3 focus:border-blaze/60'

function Field({
  id,
  label,
  hint,
  aside,
  children,
}: {
  id: string
  label: string
  hint?: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[13.5px] font-semibold text-chalk-2">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-2 text-[12.5px] leading-snug text-chalk-3">
          {hint}
        </p>
      )}
    </div>
  )
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  describedBy,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  describedBy?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        required
        placeholder="••••••••"
        value={value}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} pr-12`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-chalk-3 transition-colors hover:text-chalk"
      >
        {show ? (
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
            <path d="M17.9 17.9A10.6 10.6 0 0 1 12 19c-6.5 0-10-7-10-7a18.4 18.4 0 0 1 5.1-6M9.9 4.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a18.4 18.4 0 0 1-2.2 3.2M1 1l22 22" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  )
}

// Six boxes drawn under one transparent input, so paste, autofill
// (autocomplete="one-time-code") and the keyboard all behave like one field.
function CodeBoxes({
  value,
  onChange,
  disabled,
  invalid,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const active = Math.min(value.length, CODE_LENGTH - 1)
  return (
    <div className="relative w-full">
      <div className="grid grid-cols-6 gap-2" aria-hidden>
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const ch = value[i]
          const isActive = focused && !disabled && i === active
          return (
            <div
              key={i}
              className={`flex h-14 items-center justify-center rounded-xl bg-ink font-mono text-2xl font-bold tabular-nums text-chalk transition-colors ${
                invalid
                  ? 'border border-blaze-bright'
                  : isActive
                    ? 'border-2 border-blaze-bright'
                    : ch
                      ? 'border border-blaze/60'
                      : 'border border-line-strong'
              }`}
            >
              {ch ?? ''}
            </div>
          )
        })}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(cleanCode(e.target.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        // The code screen exists only to take this input.
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={`${CODE_LENGTH}-digit code`}
        aria-invalid={invalid || undefined}
        // Inline, because globals.css draws its focus ring with an unlayered
        // :focus-visible rule that beats Tailwind's outline-none. Focus is
        // still visible: the box being typed into gets a 2px red border.
        style={{ outline: 'none' }}
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-base text-transparent caret-transparent selection:bg-transparent"
      />
    </div>
  )
}

function useResendTimer(sentAt: number) {
  const [resendAt, setResendAt] = useState(sentAt + RESEND_COOLDOWN_SECONDS * 1000)
  const [now, setNow] = useState(() => Date.now())
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000))
  useEffect(() => {
    if (secondsLeft <= 0) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [secondsLeft])
  const restart = (seconds: number) => {
    const t = Date.now()
    setResendAt(t + seconds * 1000)
    setNow(t)
  }
  return { secondsLeft, restart }
}

function Resend({
  secondsLeft,
  sending,
  onResend,
  onBack,
}: {
  secondsLeft: number
  sending: boolean
  onResend: () => void
  onBack: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm">
      <span className="text-chalk-3">
        No code yet?{' '}
        {secondsLeft > 0 ? (
          <span className="font-semibold tabular-nums text-chalk-2">
            Resend in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
          </span>
        ) : (
          <button
            type="button"
            onClick={onResend}
            disabled={sending}
            className="-my-2 inline-block px-1 py-3 font-semibold text-blaze-bright hover:underline disabled:opacity-60"
          >
            {sending ? 'Sending…' : 'Resend code'}
          </button>
        )}
      </span>
      <button
        type="button"
        onClick={onBack}
        className="-my-2 inline-block px-1 py-3 font-semibold text-blaze-bright hover:underline"
      >
        Wrong email?
      </button>
    </div>
  )
}

function Message({ text, tone }: { text: string; tone: 'error' | 'info' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-card border px-4 py-3 text-sm leading-relaxed ${
        tone === 'error' ? 'border-blaze/50 text-chalk' : 'border-line-strong text-chalk-2'
      }`}
    >
      {text}
    </p>
  )
}

function SignupCode({
  pending,
  callbackUrl,
  afterAuth,
  onBack,
}: {
  pending: Pending
  callbackUrl: string
  afterAuth: string
  onBack: () => void
}) {
  const supabase = supabaseBrowser()
  const { email, sentAt } = pending
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [sending, setSending] = useState(false)
  const [resent, setResent] = useState(false)
  const { secondsLeft, restart } = useResendTimer(sentAt)
  const inbox = inboxFor(email)

  // The email still carries a link. If it signed THIS browser in (same
  // browser, no in-app hop), move on without asking for the code.
  useEffect(() => {
    let gone = false
    async function check() {
      if (gone || document.visibilityState !== 'visible') return
      const { data } = await supabase.auth.getSession()
      const user = data.session?.user
      if (gone || !user?.email || user.email.toLowerCase() !== email.toLowerCase()) return
      gone = true
      capture(EVENTS.SIGNUP_VERIFIED, { method: 'link' })
      writePending(null)
      window.location.assign(afterAuth)
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      gone = true
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [email, afterAuth, supabase])

  async function verify(value: string) {
    if (verifying || value.length !== CODE_LENGTH) return
    setVerifying(true)
    setError(null)
    const { data, error: err } = await supabase.auth.verifyOtp({ email, token: value, type: 'email' })
    if (err || !data.session) {
      setVerifying(false)
      setError(codeErrorMessage(err))
      setCode('')
      return
    }
    capture(EVENTS.SIGNUP_VERIFIED, { method: 'code' })
    writePending(null)
    window.location.assign(afterAuth)
  }

  async function resend() {
    if (sending || secondsLeft > 0) return
    setSending(true)
    setError(null)
    const { error: err } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: callbackUrl },
    })
    setSending(false)
    if (err) {
      const wait = secondsUntilRetry(err)
      if (wait !== null) restart(wait)
      else setError(signupErrorMessage(err))
      return
    }
    setResent(true)
    restart(RESEND_COOLDOWN_SECONDS)
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[11px] font-bold tracking-[0.3em] text-blaze-bright">ONE MORE STEP</p>
        <h1 className="mt-3 font-athletic text-3xl font-black uppercase leading-none tracking-tight sm:text-4xl">
          Check your email.
        </h1>
        <p className="mt-3 leading-relaxed text-chalk-2">
          We sent a {CODE_LENGTH}-digit code to{' '}
          <span className="break-all font-semibold text-chalk">{email}</span>. Type it here and
          you&apos;re in.
        </p>
      </div>
      <CodeBoxes
        value={code}
        onChange={(v) => {
          setCode(v)
          if (error) setError(null)
          if (v.length === CODE_LENGTH) void verify(v)
        }}
        disabled={verifying}
        invalid={Boolean(error)}
        autoFocus
      />
      {error && <Message text={error} tone="error" />}
      {resent && !error && <Message text="A new code is on its way. Use the newest email." tone="info" />}
      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={code.length < CODE_LENGTH || verifying}
        onClick={() => void verify(code)}
      >
        {verifying ? 'Checking…' : 'Verify and start'}
      </Button>
      {inbox && (
        <a
          href={inbox.url}
          target="_blank"
          rel="noopener noreferrer"
          className="press flex min-h-[48px] w-full items-center justify-center rounded-card border border-line-strong text-sm font-semibold text-chalk-2 hover:text-chalk"
        >
          Open {inbox.name}
        </a>
      )}
      <Resend secondsLeft={secondsLeft} sending={sending} onResend={() => void resend()} onBack={onBack} />
    </div>
  )
}

function ResetWithCode({
  pending,
  resetRedirect,
  afterAuth,
  onBack,
}: {
  pending: Pending
  resetRedirect: string
  afterAuth: string
  onBack: () => void
}) {
  const supabase = supabaseBrowser()
  const { email, sentAt } = pending
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const { secondsLeft, restart } = useResendTimer(sentAt)
  const inbox = inboxFor(email)

  async function save() {
    if (saving) return
    if (code.length !== CODE_LENGTH) {
      setError(`Type the ${CODE_LENGTH}-digit code from the email.`)
      return
    }
    const pwErr = passwordStrengthError(password)
    if (pwErr) {
      setError(pwErr)
      return
    }
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' })
    if (err || !data.session) {
      setSaving(false)
      setError(codeErrorMessage(err))
      setCode('')
      return
    }
    const { error: upErr } = await supabase.auth.updateUser({ password })
    if (upErr) {
      setSaving(false)
      setError(signupErrorMessage(upErr))
      return
    }
    capture(EVENTS.PASSWORD_RESET, { method: 'code' })
    writePending(null)
    window.location.assign(afterAuth)
  }

  async function resend() {
    if (sending || secondsLeft > 0) return
    setSending(true)
    setError(null)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: resetRedirect })
    setSending(false)
    if (err) {
      const wait = secondsUntilRetry(err)
      if (wait !== null) restart(wait)
      else setError(signupErrorMessage(err))
      return
    }
    restart(RESEND_COOLDOWN_SECONDS)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      className="space-y-5"
    >
      <div>
        <p className="font-mono text-[11px] font-bold tracking-[0.3em] text-blaze-bright">RESET YOUR PASSWORD</p>
        <h1 className="mt-3 font-athletic text-3xl font-black uppercase leading-none tracking-tight sm:text-4xl">
          Check your email.
        </h1>
        <p className="mt-3 leading-relaxed text-chalk-2">
          If <span className="break-all font-semibold text-chalk">{email}</span> has an account,
          we sent it a {CODE_LENGTH}-digit code. Type it here, then pick a new password.
        </p>
      </div>
      <CodeBoxes
        value={code}
        onChange={(v) => {
          setCode(v)
          if (error) setError(null)
        }}
        disabled={saving}
        invalid={Boolean(error) && code.length === 0}
        autoFocus
      />
      <Field id="new-password" label="New password" hint="8 or more characters, with a letter and a number.">
        <PasswordInput
          id="new-password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          describedBy="new-password-hint"
        />
      </Field>
      {error && <Message text={error} tone="error" />}
      <Button type="submit" size="lg" className="w-full" disabled={saving}>
        {saving ? 'Saving…' : 'Save new password'}
      </Button>
      {inbox && (
        <a
          href={inbox.url}
          target="_blank"
          rel="noopener noreferrer"
          className="press flex min-h-[48px] w-full items-center justify-center rounded-card border border-line-strong text-sm font-semibold text-chalk-2 hover:text-chalk"
        >
          Open {inbox.name}
        </a>
      )}
      <Resend secondsLeft={secondsLeft} sending={sending} onResend={() => void resend()} onBack={onBack} />
    </form>
  )
}

function InAppNotice({ app }: { app: InAppBrowser }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="rounded-card border border-line-strong p-4">
      <p className="text-sm leading-relaxed text-chalk-2">
        You&apos;re in {app.app}&apos;s browser. Sign up right here: we&apos;ll email you a{' '}
        {CODE_LENGTH}-digit code, so you never have to leave this screen.
      </p>
      <button
        type="button"
        onClick={() => {
          const url = new URL(window.location.href)
          if (!url.searchParams.has('utm_source')) {
            url.searchParams.set('utm_source', app.slug)
            url.searchParams.set('utm_medium', 'in_app_browser')
          }
          void navigator.clipboard?.writeText(url.toString()).then(
            () => {
              setCopied(true)
              capture(EVENTS.IN_APP_LINK_COPIED, { app: app.slug })
            },
            () => setCopied(false)
          )
        }}
        className="-mb-2 mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-blaze-bright hover:underline"
      >
        {copied ? 'Link copied. Paste it into ' + systemBrowserName(app.os) + '.' : `Or copy the link to open in ${systemBrowserName(app.os)}`}
      </button>
    </div>
  )
}

function AuthForm() {
  const params = useSearchParams()
  // Carried from the landing's Go Pro CTA (/auth/signup?plan=pro), so a paid
  // click lands on checkout rather than the Locker room. `next` wins over it:
  // someone who arrived from an invite or a shared verdict goes back there.
  const wantsPro = params.get('plan') === 'pro'
  const next = safeNextPath(params.get('next'))
  const proPath = params.get('period') === 'monthly' ? '/upgrade?period=monthly' : '/upgrade'
  const afterAuth = next ?? (wantsPro ? proPath : '/dashboard')
  const mode = params.get('mode')

  const [view, setView] = useState<View>(
    mode === 'signup' ? 'signup' : mode === 'forgot' ? 'forgot' : 'signin'
  )
  const [pending, setPending] = useState<Pending | null>(null)
  const [inApp, setInApp] = useState<InAppBrowser | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const restored = useRef(false)

  const supabase = supabaseBrowser()
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const callbackUrl = `${origin}/auth/callback?next=${encodeURIComponent(afterAuth)}`
  const resetRedirect = `${origin}/auth/callback?next=${encodeURIComponent('/auth/reset')}`

  // Browser-only reads, once: a code screen this tab was already on (the page
  // reloaded while they were in their mail app), and the in-app browser check.
  // Syncing from sessionStorage and the user agent, neither of which exists
  // during the server render; the same waiver the arenas take for their timers.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const p = readPending()
    setInApp(detectInAppBrowser(navigator.userAgent))
    if (p && Date.now() - p.sentAt < 60 * 60 * 1000) {
      setPending(p)
      setEmail(p.email)
      setView(p.kind === 'signup' ? 'code' : 'reset')
    }
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  const go = (v: View) => {
    setView(v)
    setMessage(null)
    setUnconfirmed(false)
  }

  const startPending = (kind: Pending['kind']) => {
    const p: Pending = { email: email.trim(), sentAt: Date.now(), kind }
    writePending(p)
    setPending(p)
    go(kind === 'signup' ? 'code' : 'reset')
  }

  const backFromCode = () => {
    writePending(null)
    setPending(null)
    go(pending?.kind === 'recovery' ? 'forgot' : 'signup')
  }

  async function signUp() {
    const uErr = usernameError(username.trim())
    if (uErr) return setMessage({ text: uErr, tone: 'error' })
    const pwErr = passwordStrengthError(password)
    if (pwErr) return setMessage({ text: pwErr, tone: 'error' })

    // Username rides along as auth metadata; the on_auth_user_created trigger
    // (handle_new_user) writes the profile row from it. Never insert profiles
    // from the client: it collides with the trigger on profiles_pkey.
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: callbackUrl, data: { username: username.trim() } },
    })
    if (error) return setMessage({ text: signupErrorMessage(error), tone: 'error' })
    // Supabase answers an address that already has an account with a user and
    // no identities rather than an error, so it cannot be used to probe for
    // accounts. Say what to do instead of sending a code that will not come.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      return setMessage({ text: 'That email already has an account. Sign in instead.', tone: 'error' })
    }
    capture(EVENTS.SIGNED_UP, {
      method: 'email',
      intent: wantsPro ? 'pro' : 'free',
      in_app_browser: inApp?.slug ?? null,
    })
    // Confirmations switched off: there is already a session.
    if (data.session) {
      window.location.assign(afterAuth)
      return
    }
    startPending('signup')
  }

  async function signIn() {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      setUnconfirmed(error.code === 'email_not_confirmed')
      return setMessage({ text: signinErrorMessage(error), tone: 'error' })
    }
    window.location.href = afterAuth
  }

  async function sendResetCode() {
    if (!email.trim()) return setMessage({ text: 'Type the email you signed up with.', tone: 'error' })
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: resetRedirect })
    if (error) {
      const wait = secondsUntilRetry(error)
      return setMessage({
        text: wait !== null ? `Wait ${wait} seconds, then try again.` : signupErrorMessage(error),
        tone: 'error',
      })
    }
    startPending('recovery')
  }

  async function sendSignupCode() {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl },
    })
    if (error) return setMessage({ text: signupErrorMessage(error), tone: 'error' })
    startPending('signup')
  }

  const submit = async () => {
    setLoading(true)
    setMessage(null)
    try {
      if (view === 'signup') await signUp()
      else if (view === 'forgot') await sendResetCode()
      else await signIn()
    } finally {
      setLoading(false)
    }
  }

  let body: ReactNode
  if (view === 'code' && pending) {
    body = <SignupCode pending={pending} callbackUrl={callbackUrl} afterAuth={afterAuth} onBack={backFromCode} />
  } else if (view === 'reset' && pending) {
    body = <ResetWithCode pending={pending} resetRedirect={resetRedirect} afterAuth={afterAuth} onBack={backFromCode} />
  } else {
    const isSignUp = view === 'signup'
    const isForgot = view === 'forgot'
    body = (
      <div className="space-y-6">
        {isSignUp && inApp && <InAppNotice app={inApp} />}
        <div>
          <p className="font-mono text-[11px] font-bold tracking-[0.3em] text-blaze-bright">
            {isSignUp ? 'NEW CHALLENGER' : isForgot ? 'LOCKED OUT?' : 'BACK FOR MORE'}
          </p>
          <h1 className="mt-3 font-athletic text-3xl font-black uppercase leading-none tracking-tight sm:text-4xl">
            {isSignUp ? 'Make your account.' : isForgot ? 'Reset your password.' : 'Welcome back.'}
          </h1>
          {isSignUp && (
            <p className="mt-3 leading-relaxed text-chalk-2">
              The first 100 accounts are founders: 30% off everything, forever.
            </p>
          )}
          {isForgot && (
            <p className="mt-3 leading-relaxed text-chalk-2">
              Type the email you signed up with and we&apos;ll send a {CODE_LENGTH}-digit code.
            </p>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="space-y-5"
        >
          {isSignUp && (
            <Field id="username" label="Username" hint="Shows on the Board and on verdicts you share. Letters, numbers and _.">
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={20}
                placeholder="hoop_scholar"
                value={username}
                aria-describedby="username-hint"
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass}
              />
            </Field>
          )}

          <Field id="email" label="Email">
            <input
              id="email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </Field>

          {!isForgot && (
            <Field
              id="password"
              label="Password"
              hint={isSignUp ? '8 or more characters, with a letter and a number.' : undefined}
              aside={
                !isSignUp ? (
                  <button
                    type="button"
                    onClick={() => go('forgot')}
                    className="-my-3 py-3 text-[13.5px] font-semibold text-blaze-bright hover:underline"
                  >
                    Forgot password?
                  </button>
                ) : undefined
              }
            >
              <PasswordInput
                id="password"
                value={password}
                onChange={setPassword}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                describedBy={isSignUp ? 'password-hint' : undefined}
              />
            </Field>
          )}

          {message && <Message text={message.text} tone={message.tone} />}
          {unconfirmed && (
            <button
              type="button"
              onClick={() => void sendSignupCode()}
              className="-mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-blaze-bright hover:underline"
            >
              Send me a code to confirm it
            </button>
          )}

          <Button type="submit" size="lg" disabled={loading} className="w-full">
            {loading ? 'One sec…' : isSignUp ? 'Create account' : isForgot ? 'Send code' : 'Sign in'}
          </Button>
        </form>

        <p className="text-center text-sm text-chalk-3">
          {isSignUp ? 'Already have an account?' : isForgot ? 'Remembered it?' : 'New here?'}{' '}
          <button
            type="button"
            onClick={() => go(isSignUp || isForgot ? 'signin' : 'signup')}
            className="-my-2 inline-block px-2 py-3 font-semibold text-blaze-bright hover:underline"
          >
            {isSignUp || isForgot ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </div>
    )
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-ink text-chalk">
      <div className="grain" aria-hidden />
      <div className="court-floor" aria-hidden />

      <header className="relative z-10 mx-auto flex h-14 max-w-md items-center px-5">
        <Link href="/" aria-label="Heated home" className="flex items-center gap-1.5">
          <Image src="/logo-mark.png" alt="" width={64} height={64} className="h-8 w-8 -translate-y-0.5" />
          <Image src="/wordmark-red.png" alt="" width={253} height={36} className="h-4 w-auto" />
        </Link>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-md px-5 pb-16 pt-4">
        <div className="bezel p-6 sm:p-8">{body}</div>
      </div>
    </main>
  )
}

export default function LoginPage() {
  // Suspense is required: useSearchParams inside a client component.
  return (
    <Suspense fallback={<main className="min-h-dvh bg-ink" />}>
      <AuthForm />
    </Suspense>
  )
}
