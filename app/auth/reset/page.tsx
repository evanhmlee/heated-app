'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { supabaseBrowser } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { EVENTS, capture } from '@/lib/analytics'
import { passwordStrengthError, signupErrorMessage } from '@/lib/auth-copy'

// Where a CLICKED password-reset link lands: /auth/callback has exchanged the
// link's code for a session and sent the browser here to pick a new password.
// Most resets use the 6-digit code on /auth/login instead; this is for the
// people who tap the link. If the link opened in a different browser than the
// one that asked for it, there is no session, and updateUser says so.

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)

  async function save() {
    const pwErr = passwordStrengthError(password)
    if (pwErr) return setError(pwErr)
    setSaving(true)
    setError(null)
    const supabase = supabaseBrowser()
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      setSaving(false)
      setExpired(true)
      return
    }
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) {
      setSaving(false)
      setError(signupErrorMessage(err))
      return
    }
    capture(EVENTS.PASSWORD_RESET, { method: 'link' })
    window.location.assign('/dashboard')
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
        <div className="bezel space-y-5 p-6 sm:p-8">
          <div>
            <p className="font-mono text-[11px] font-bold tracking-[0.3em] text-blaze-bright">RESET YOUR PASSWORD</p>
            <h1 className="mt-3 font-athletic text-3xl font-black uppercase leading-none tracking-tight sm:text-4xl">
              Pick a new one.
            </h1>
          </div>

          {expired ? (
            <div className="space-y-4">
              <p className="leading-relaxed text-chalk-2">
                That link has expired, or it opened in a different browser from the one that asked
                for it. Send yourself a code instead and type it here.
              </p>
              <Link
                href="/auth/login?mode=forgot"
                className="game-btn clip-blade inline-flex min-h-[48px] w-full items-center justify-center font-mono text-sm font-semibold uppercase tracking-widest text-white"
              >
                Send me a code
              </Link>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
              className="space-y-5"
            >
              <div>
                <label htmlFor="new-password" className="mb-2 block text-[13.5px] font-semibold text-chalk-2">
                  New password
                </label>
                <div className="relative">
                  <input
                    id="new-password"
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    placeholder="••••••••"
                    value={password}
                    aria-describedby="new-password-hint"
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-card border border-line-strong bg-ink px-4 py-3.5 pr-12 text-chalk placeholder:text-chalk-3 focus:border-blaze/60"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-chalk-3 transition-colors hover:text-chalk"
                  >
                    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                </div>
                <p id="new-password-hint" className="mt-2 text-[12.5px] text-chalk-3">
                  8 or more characters, with a letter and a number.
                </p>
              </div>
              {error && (
                <p role="alert" className="rounded-card border border-blaze/50 px-4 py-3 text-sm text-chalk">
                  {error}
                </p>
              )}
              <Button type="submit" size="lg" className="w-full" disabled={saving}>
                {saving ? 'Saving…' : 'Save new password'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}
