import { redirect } from 'next/navigation'

// The landing page links to /auth/signup; the real form lives at /auth/login
// (one component, two modes). Keep this a server redirect so the URL stays
// shareable without duplicating the form.
//
// `plan` has to survive the hop. The landing's Go Pro CTA points here with
// ?plan=pro, and dropping it on the redirect is how the highest-intent path in
// the funnel used to end on the dashboard with no route to checkout.
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; period?: string; next?: string }>
}) {
  const { plan, period, next } = await searchParams
  const query = new URLSearchParams({ mode: 'signup' })
  if (plan === 'pro') query.set('plan', 'pro')
  // The period picked on the landing's Pro card, so /upgrade opens on it.
  if (plan === 'pro' && period === 'monthly') query.set('period', 'monthly')
  // A shared verdict's "take the other side" sends people here with a next=;
  // the login page re-checks that it is a relative path before using it.
  if (next) query.set('next', next)
  redirect(`/auth/login?${query.toString()}`)
}
