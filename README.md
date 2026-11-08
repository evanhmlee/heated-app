# Heated

Heated was a basketball debate app. You argued a take out loud, against another fan or an AI opponent, and Claude decided who won. It ran at getheated.app from October 2026 until it shut down in November 2026.

This is the whole app, released under the MIT license so anyone can read it, learn from it or run their own copy. It isn't maintained anymore, so issues and pull requests will probably go unanswered.

## What it does

- Debate a basketball take against an AI opponent, by voice or by text.
- Debate another person, either passing one phone back and forth or ranked over live video.
- Every debate has three rounds (contention, rebuttal, summary) of two minutes each. AssemblyAI transcribes what you said, and Claude scores both sides and writes the verdict.
- A daily prompt that everyone answers, with one winner per day.
- Points, a leaderboard, badges, and verdict cards you can share as a link or an image.
- Tickets: every debate costs one. Free accounts earn them slowly, and Pro (a Stripe subscription) earns them faster.
- NBA facts for the judge and the AI opponent come from ESPN's public JSON endpoints. Rosters refresh every night, and career stats and awards are cached the first time a player comes up. Claude's NBA knowledge stops at its training cutoff, and before this was added the judge marked real trades as made up.
- Moderation for slurs and profanity, with penalties that escalate during a debate.

## Stack

Next.js 16 (App Router), TypeScript, Tailwind CSS 4, Supabase for auth and Postgres, Claude (Sonnet 4.5 judges and argues, Haiku 4.5 writes topics), AssemblyAI, Daily for live video, Stripe and PostHog. It was built to deploy on Vercel.

## What it costs to run

Hosting can be free. Vercel's Hobby plan and Supabase's free plan both handle small traffic, although a free Supabase project pauses after a week with no activity.

The debates are what cost money. Each one calls AssemblyAI and Claude, roughly $0.09 to $0.13 per debate, charged to whoever owns the API keys. If you put a copy where strangers can reach it, set spending limits on both accounts first.

## Running it yourself

You need Node 20 or newer, a Supabase project, an Anthropic API key and an AssemblyAI API key. Stripe, Daily and PostHog are optional.

1. Install the dependencies and copy the env template:

   ```bash
   npm install
   cp .env.local.example .env.local
   ```

2. Fill in `.env.local`. The file explains each variable.

3. Create the database by running every file in `supabase/migrations` in filename order. Each file is named for when it ran on the production database, so that order is the one known to work. Paste them into the Supabase SQL editor one at a time, or use psql with the connection string from the Supabase dashboard (Connect):

   ```bash
   for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
   ```

4. Set up sign-in. Accounts use an email and password, confirmed with a 6-digit code. In Supabase, open Authentication, then Emails, and add `{{ .Token }}` to the Confirm signup and Reset password templates. Set the Site URL to wherever the app runs (`http://localhost:3000` locally).

5. Start it:

   ```bash
   npm run dev
   ```

   With `NEXT_PUBLIC_AUTH_LIVE` unset you only get the landing page. Set it to `true` to open the app.

6. Load the NBA rosters once so the judge has current teams. After that the nightly cron keeps them fresh:

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/refresh-nba-teams
   ```

### Optional pieces

- Live ranked debates need `DAILY_API_KEY`. Daily's free tier covers light use. Without it, everything else still works.
- Payments need Stripe. Run `STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs` once per Stripe mode. It creates the Pro prices and the founding coupon and prints the coupon id for `STRIPE_FOUNDING_COUPON_ID`. Then point a webhook at `/api/stripe-webhook` with the events `checkout.session.completed`, `customer.subscription.updated` and `customer.subscription.deleted`.
- `vercel.json` schedules two daily crons: one pays out the daily prompt winner and one refreshes rosters. Both refuse to run without `CRON_SECRET`, which Vercel sends for you on scheduled runs.

## Before you put it online

Some of it still points at the original deployment. The legal pages and the support address (`components/legal.tsx`), the site URL in `app/layout.tsx`, and a fallback host in `app/v/[id]/page.tsx` all name getheated.app, which no longer runs. Swap in your own. The prices shown in the app live in `lib/tickets.ts` and need to match whatever you create in Stripe.

## Where things are

- `app/api/debate/` is the debate engine: rounds, transcription, the AI opponent and the judge.
- `lib/debate.ts` holds the judge and opponent prompts, including the rules that keep Claude from contradicting current NBA facts.
- `lib/nba-*.ts` covers the ESPN grounding and its caches.
- `supabase/migrations/` is the full schema, with the row-level security policies and the trigger that charges tickets.
- `scripts/` has the Stripe setup, a judge bias test (`judge-eval.mjs`, which swaps the debaters' seats and measures how much the verdict moves) and two consistency checks.

## License

MIT, see [LICENSE](LICENSE). The Anton and Archivo fonts in `public/fonts` are under the SIL Open Font License.
