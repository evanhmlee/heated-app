import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Link-unfurl card for group chats, DMs, and social shares: the referral
// path IS the growth loop, so the unfurl has to carry the brand on its own.
// Colors mirror the globals.css tokens (ink/chalk/blaze); Archivo-SemiBold is
// bundled in public/fonts so the poster type survives environments without
// system fonts.

export const alt = "Heated: every argument, settled. AI-judged basketball debates.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const archivo = await readFile(
    join(process.cwd(), "public/fonts/Archivo-SemiBold.ttf"),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#070811",
          backgroundImage:
            "radial-gradient(ellipse 90% 65% at 50% 115%, rgba(216,31,31,0.38), transparent 70%)",
          padding: "64px 72px",
          fontFamily: "Archivo",
        }}
      >
        {/* Top row: brand + status tag */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 44,
              fontWeight: 600,
              color: "#f04a38",
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              fontStyle: "italic",
            }}
          >
            Heated
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              color: "rgba(244,246,251,0.6)",
              letterSpacing: "0.3em",
              textTransform: "uppercase",
            }}
          >
            AI-Judged Basketball Debates
          </div>
        </div>

        {/* Poster headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            lineHeight: 0.95,
            textTransform: "uppercase",
          }}
        >
          <div style={{ display: "flex", fontSize: 132, color: "#f4f6fb" }}>
            Every argument.
          </div>
          <div style={{ display: "flex", fontSize: 132, color: "#f04a38" }}>
            Settled.
          </div>
        </div>

        {/* Bottom scoreline, echoing the verdict card */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            fontSize: 26,
            color: "rgba(244,246,251,0.7)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          <div
            style={{
              display: "flex",
              backgroundColor: "#d81f1f",
              color: "#ffffff",
              padding: "10px 22px",
              fontSize: 24,
              letterSpacing: "0.22em",
            }}
          >
            Final Verdict 88 - 74
          </div>
          <div style={{ display: "flex" }}>One judge. Real NBA stats.</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Archivo",
          data: archivo,
          style: "normal",
          weight: 600,
        },
      ],
    },
  );
}
