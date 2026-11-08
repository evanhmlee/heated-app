import Link from "next/link";
import type { ReactNode } from "react";

/*
 * Shared shell + typography for the legal pages (/privacy, /terms).
 * APP_NAME and CONTACT_EMAIL are the single swap points for the
 * eventual rename and a dedicated support inbox.
 *
 * CONTACT_EMAIL is read by eight mailto: links across /privacy and /terms and
 * by the founder-discount failure on /upgrade, which is the one place a user
 * is told to email us mid-purchase. It pointed at pitchcoachai@gmail.com, the
 * other product's inbox, until 2026-09-04.
 *
 * This has to be a mailbox that actually receives: the legal pages name it as
 * the route for data-deletion and privacy requests, so a bounce is a
 * compliance problem, not just a dead link.
 */
export const APP_NAME = "Heated";
export const CONTACT_EMAIL = "support@getheated.app";

export function LegalShell({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-ink text-chalk">
      <main className="mx-auto max-w-3xl px-5 py-14 sm:py-20">
        {/* A standalone nav control, so it gets a real 44px target. The inline
            links inside the legal prose deliberately do NOT: a link sitting in
            a sentence cannot be 44px tall without breaking the line box, and
            WCAG exempts targets inline in a block of text for exactly that
            reason. */}
        <Link
          href="/"
          className="-ml-1 inline-flex min-h-[44px] items-center px-1 font-mono text-[11px] uppercase tracking-[0.25em] text-chalk-3 transition-colors hover:text-chalk"
        >
          &larr; {APP_NAME}
        </Link>

        <h1 className="mt-10 font-athletic text-4xl font-black uppercase leading-none tracking-tight sm:text-5xl">
          {title}
        </h1>
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.25em] text-chalk-3">
          Last updated {updated}
        </p>

        <div className="mt-8 space-y-4">{intro}</div>

        <div className="mt-12 space-y-12">{children}</div>

        <footer className="mt-16 border-t border-line pt-8 space-y-4">
          <P>
            {APP_NAME} is an independent product. It is not affiliated with,
            endorsed by, or sponsored by the National Basketball Association
            (NBA), any NBA team, or any player. Player and team names are used
            only to identify the subjects of debate topics and factual
            statistics.
          </P>
          <p className="text-sm text-chalk-3">
            <LegalLink href="/privacy">Privacy Policy</LegalLink>
            <span className="mx-3 text-chalk-3">/</span>
            <LegalLink href="/terms">Terms of Service</LegalLink>
          </p>
        </footer>
      </main>
    </div>
  );
}

export function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="space-y-4">
      <h2 className="font-bold tracking-tight text-lg">{title}</h2>
      {children}
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-chalk-2">{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-chalk-2 marker:text-blaze-bright">
      {children}
    </ul>
  );
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-chalk">{children}</strong>;
}

export function LegalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const external = href.startsWith("http") || href.startsWith("mailto:");
  const cls =
    "text-blaze-bright underline decoration-blaze-bright/40 underline-offset-2 transition-colors hover:decoration-blaze-bright";
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
