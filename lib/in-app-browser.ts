// Spots the browsers that live inside social apps (TikTok, Instagram and the
// rest), where most Heated signups are expected to come from. An email link
// opened from the mail app lands in Safari or Chrome, a different browser from
// the one that started the signup, so the signup screen says up front that a
// 6-digit code is coming and offers a way out to the system browser.
//
// Matched on the user agent tokens each app adds. X/Twitter and Reddit are
// missing on purpose: they open links in Safari View Controller or Chrome
// Custom Tabs, which share the system browser's storage. Ported from
// pitchcoachai/lib/in-app-browser.ts.

export type InAppBrowser = {
  /** The app's name as people know it, for "You are browsing inside TikTok". */
  app: string
  /** Lowercase, for utm_source on the link we hand to Safari or Chrome. */
  slug: string
  os: 'ios' | 'android' | 'other'
}

const APPS: { pattern: RegExp; app: string; slug: string }[] = [
  { pattern: /musical_ly|BytedanceWebview|TikTok|\btrill_\d/i, app: 'TikTok', slug: 'tiktok' },
  { pattern: /Instagram/i, app: 'Instagram', slug: 'instagram' },
  // Messenger before Facebook: Messenger's agent carries the FBAN token too.
  { pattern: /FBAN\/Messenger|MessengerForiOS|FB_IAB\/Orca|Orca-Android/i, app: 'Messenger', slug: 'messenger' },
  { pattern: /FBAN|FBAV|FB_IAB|FBIOS/i, app: 'Facebook', slug: 'facebook' },
  { pattern: /Snapchat/i, app: 'Snapchat', slug: 'snapchat' },
  { pattern: /LinkedInApp/i, app: 'LinkedIn', slug: 'linkedin' },
  { pattern: /Pinterest/i, app: 'Pinterest', slug: 'pinterest' },
  { pattern: /MicroMessenger/i, app: 'WeChat', slug: 'wechat' },
  { pattern: /\bLine\//i, app: 'LINE', slug: 'line' },
]

export function detectInAppBrowser(ua: string | null | undefined): InAppBrowser | null {
  if (!ua) return null
  const hit = APPS.find(a => a.pattern.test(ua))
  if (!hit) return null
  const os = /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : 'other'
  return { app: hit.app, slug: hit.slug, os }
}

/** "Safari" on iPhone, "Chrome" on Android, "your browser" anywhere else. */
export function systemBrowserName(os: InAppBrowser['os']): string {
  return os === 'ios' ? 'Safari' : os === 'android' ? 'Chrome' : 'your browser'
}
