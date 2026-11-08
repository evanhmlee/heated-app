// Pure helpers for the sign-in screens: validation, the error copy, and the
// small bits of the 6-digit code flow. No React, no Supabase client, so they
// can be read and tested on their own. Most of this is ported from
// pitchcoachai/lib/signup.ts, which has run the same flow since 2026-10-04.

export const CODE_LENGTH = 6
export const RESEND_COOLDOWN_SECONDS = 60

// Client-side password strength gate for signup. Blocks the trivially weak
// passwords breach lists are full of (short, letters-only, digits-only).
export function passwordStrengthError(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.'
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw))
    return 'Include at least one letter and one number.'
  return null
}

// Usernames go straight onto the public Board, so keep them tame: 3-20 chars,
// letters, numbers and underscores (the handle_new_user trigger's rule).
export function usernameError(u: string): string | null {
  if (u.length < 3) return 'Your username needs at least 3 characters.'
  if (u.length > 20) return 'Your username can be at most 20 characters.'
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return 'Letters, numbers and underscores only.'
  return null
}

/** Only same-origin relative paths, so a crafted ?next= cannot redirect off site. */
export function safeNextPath(next: string | null | undefined): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null
}

/** Digits only, at most CODE_LENGTH, so a pasted "123 456" still works. */
export function cleanCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH)
}

const INBOXES: { domain: RegExp; name: string; url: string }[] = [
  { domain: /^(gmail|googlemail)\.com$/, name: 'Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' },
  { domain: /^(outlook|hotmail|live|msn)\.[a-z.]+$/, name: 'Outlook', url: 'https://outlook.live.com/mail/0/inbox' },
  { domain: /^(yahoo|ymail)\.[a-z.]+$/, name: 'Yahoo Mail', url: 'https://mail.yahoo.com' },
  { domain: /^(icloud|me|mac)\.com$/, name: 'iCloud Mail', url: 'https://www.icloud.com/mail' },
]

/** The inbox the code screen can open, for the big providers only. A school or work address gets no button rather than a wrong guess. */
export function inboxFor(email: string): { name: string; url: string } | null {
  const domain = email.trim().toLowerCase().split('@')[1] ?? ''
  const hit = INBOXES.find((i) => i.domain.test(domain))
  return hit ? { name: hit.name, url: hit.url } : null
}

type AuthErrorLike = { code?: string; message?: string; status?: number } | null | undefined

/** Seconds Supabase says to wait before it will send this address another email, when that is what went wrong. */
export function secondsUntilRetry(err: AuthErrorLike): number | null {
  const m = err?.message?.match(/after (\d+) seconds?/i)
  return m ? Number(m[1]) : null
}

function isNetworkError(err: AuthErrorLike): boolean {
  return !err?.status && /fetch|network|load failed/i.test(err?.message ?? '')
}

const OFFLINE = 'We could not reach Heated. Check your connection and try again.'

export function signupErrorMessage(err: AuthErrorLike): string {
  if (isNetworkError(err)) return OFFLINE
  switch (err?.code) {
    case 'weak_password':
      return 'That password is too easy to guess, or it has shown up in a data breach. Pick a different one.'
    case 'email_address_invalid':
      return 'Check the email address. It does not look right.'
    case 'user_already_exists':
    case 'email_exists':
      return 'That email already has an account. Sign in instead.'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'We could not send the email just now. Wait a minute, then try again.'
  }
  return err?.message || 'Something went wrong. Try again.'
}

// Supabase's raw strings ("Invalid login credentials") used to be shown as they
// came, with nowhere to go from them.
export function signinErrorMessage(err: AuthErrorLike): string {
  if (isNetworkError(err)) return OFFLINE
  switch (err?.code) {
    case 'invalid_credentials':
      return "That email and password don't match. Try again, or reset your password."
    case 'email_not_confirmed':
      return "You haven't confirmed this email yet."
    case 'over_request_rate_limit':
      return 'Too many tries. Wait a minute, then try again.'
  }
  if (/invalid login credentials/i.test(err?.message ?? '')) {
    return "That email and password don't match. Try again, or reset your password."
  }
  return err?.message || 'Something went wrong. Try again.'
}

export function codeErrorMessage(err: AuthErrorLike): string {
  if (isNetworkError(err)) return OFFLINE
  if (err?.code === 'over_request_rate_limit' || err?.status === 429) {
    return 'Too many tries. Wait a minute, then try again.'
  }
  return 'That code did not work. Check the newest email, or send a new code.'
}
