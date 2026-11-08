"use client";

import { useEffect, useRef } from "react";

/*
 * Autoplaying, muted, seamless-loop product capture inside a phone bezel.
 * Rules that keep it honest and cheap:
 * - Muted + playsInline so it autoplays on mobile without going fullscreen.
 * - Plays only while in view (IntersectionObserver) to spare battery/CPU;
 *   the loops are seamless so a mid-cycle scroll-in still catches a full arc.
 * - prefers-reduced-motion: never plays. The poster frame (the static verdict
 *   still, already a shipped asset) stands in, so nothing is lost.
 * - mp4 (H.264) FIRST, webm only as an optional extra. This order is
 *   deliberate and load-bearing: browsers take the first source whose type
 *   they claim to support, and iOS Safari (17.4+) claims video/webm while its
 *   VP9 decoding is device- and version-dependent. When it accepts the source
 *   and then cannot decode it, it clears the poster and paints an empty grey
 *   box, which is what shipped. H.264 is hardware-decoded on every phone, so
 *   putting it first makes the outcome the same everywhere.
 *   The old order also cost mobile users real bytes: these VP9 files encode
 *   ~3x LARGER than the H.264 ones, so webm-first was the bigger download AND
 *   the fragile one. Do not flip this back without re-checking both.
 * - poster covers the paused/first-paint state so there is never an empty box.
 */
export default function LoopVideo({
  mp4,
  webm,
  poster,
  label,
  className = "",
  videoClassName = "",
}: {
  mp4: string;
  webm?: string;
  poster: string;
  label: string;
  className?: string;
  videoClassName?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reduce) return; // leave paused on the poster frame

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          v.play().catch(() => {});
        } else {
          v.pause();
        }
      },
      { threshold: 0.35 }
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  return (
    <div
      className={`overflow-hidden rounded-[34px] border-[9px] border-[#1a1d24] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)] ${className}`}
    >
      <video
        ref={ref}
        className={`block h-auto w-full ${videoClassName}`}
        poster={poster}
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={label}
      >
        <source src={mp4} type="video/mp4" />
        {webm && <source src={webm} type="video/webm" />}
      </video>
    </div>
  );
}
