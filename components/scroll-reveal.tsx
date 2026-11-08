"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Fade-up on first viewport entry. Motion lives in globals.css (.sreveal),
// where prefers-reduced-motion disables it entirely.
export default function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Fail open: content must never stay hidden because observation is
    // unavailable or suppressed (old browsers, prerendered/background tabs).
    // The synchronous setState here is deliberate: reveal immediately, once.
    if (typeof IntersectionObserver === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInView(true);
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      setInView(true);
      return;
    }

    // Pre-trigger a quarter-screen early with a near-zero threshold: on fast
    // momentum scrolls the 0.8s fade otherwise leaves whole folds blank when
    // they land in view (reads as a broken page mid-flick).
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.01, rootMargin: "0px 0px 25% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`sreveal ${inView ? "in" : ""} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
