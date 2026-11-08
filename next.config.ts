import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Reverse-proxy PostHog through our own domain so ad-blockers don't drop
  // analytics. proxy.ts's matcher is ['/', '/dashboard/:path*'], so /ingest
  // never touches the auth gate. Keep those two facts together: adding
  // '/ingest' to the matcher would send every capture through Supabase auth.
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  // The paths people type off the screen and the bio link (marketing/growth/
  // profile.md): getheated.app/tt and /ig, plus an optional campaign segment
  // per post (/tt/verdict-a). They land on the homepage tagged, and PostHog
  // keeps the first utm_* it sees on the person, so a signup credits the post
  // that brought it. 307 rather than 308 so the tags can change later without
  // browsers having cached the old target.
  async redirects() {
    const social = [
      { path: "tt", source: "tiktok" },
      { path: "ig", source: "instagram" },
    ];
    return social.flatMap(({ path, source }) => [
      {
        source: `/${path}`,
        destination: `/?utm_source=${source}&utm_medium=social`,
        permanent: false,
      },
      {
        source: `/${path}/:campaign`,
        destination: `/?utm_source=${source}&utm_medium=social&utm_campaign=:campaign`,
        permanent: false,
      },
    ]);
  },
  // PostHog uses trailing-slash API paths; don't let Next redirect them away.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
