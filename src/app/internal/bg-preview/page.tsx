"use client";

import { useState } from "react";

type Palette = {
  name: string;
  pink: string;
  white: string;
  pink2: string;
};

const palettes: Palette[] = [
  {
    name: "Current (pink)",
    pink: "rgba(217, 64, 153, ALPHA)",
    white: "rgba(255, 255, 255, ALPHA)",
    pink2: "rgba(217, 64, 153, ALPHA)",
  },
  {
    name: "Sand + terracotta",
    pink: "rgba(214, 180, 130, ALPHA)",
    white: "rgba(255, 245, 230, ALPHA)",
    pink2: "rgba(196, 110, 75, ALPHA)",
  },
  {
    name: "Sand + chocolate",
    pink: "rgba(205, 165, 115, ALPHA)",
    white: "rgba(250, 235, 215, ALPHA)",
    pink2: "rgba(110, 65, 40, ALPHA)",
  },
  {
    name: "Sand + deep cocoa",
    pink: "rgba(200, 160, 110, ALPHA)",
    white: "rgba(245, 225, 200, ALPHA)",
    pink2: "rgba(75, 45, 30, ALPHA)",
  },
  {
    name: "Sand + light sand + chocolate",
    pink: "rgba(196, 110, 75, ALPHA)",
    white: "rgba(220, 195, 155, ALPHA)",
    pink2: "rgba(95, 55, 35, ALPHA)",
  },
  {
    name: "Light sand + amber + dark chocolate",
    pink: "rgba(225, 200, 160, ALPHA)",
    white: "rgba(210, 145, 70, ALPHA)",
    pink2: "rgba(70, 40, 25, ALPHA)",
  },
  {
    name: "Light sand + warm amber + cocoa",
    pink: "rgba(230, 205, 165, ALPHA)",
    white: "rgba(220, 155, 80, ALPHA)",
    pink2: "rgba(85, 50, 30, ALPHA)",
  },
  {
    name: "Pale dune + golden amber + espresso",
    pink: "rgba(235, 215, 180, ALPHA)",
    white: "rgba(200, 140, 60, ALPHA)",
    pink2: "rgba(55, 30, 20, ALPHA)",
  },
  {
    name: "Soft sand + burnt amber + dark cocoa",
    pink: "rgba(220, 195, 155, ALPHA)",
    white: "rgba(195, 120, 50, ALPHA)",
    pink2: "rgba(65, 35, 22, ALPHA)",
  },
  {
    name: "Honey sand + amber + bittersweet",
    pink: "rgba(230, 200, 150, ALPHA)",
    white: "rgba(215, 150, 70, ALPHA)",
    pink2: "rgba(60, 32, 18, ALPHA)",
  },
  {
    name: "Cool sand + amber + chocolate",
    pink: "rgba(215, 195, 165, ALPHA)",
    white: "rgba(205, 140, 65, ALPHA)",
    pink2: "rgba(80, 45, 28, ALPHA)",
  },
  {
    name: "Pale dune + amber",
    pink: "rgba(220, 200, 165, ALPHA)",
    white: "rgba(255, 250, 240, ALPHA)",
    pink2: "rgba(210, 140, 70, ALPHA)",
  },
];

function fillAlpha(template: string, a: number) {
  return template.replace("ALPHA", a.toString());
}

export default function BgPreviewPage() {
  const [selected, setSelected] = useState(0);
  const p = palettes[selected];

  const pinkBg = `radial-gradient(ellipse 80% 60% at 50% 50%, ${fillAlpha(p.pink, 0.12)} 0%, ${fillAlpha(p.pink, 0.06)} 40%, transparent 70%)`;
  const whiteBg = `radial-gradient(ellipse 70% 80% at 50% 50%, ${fillAlpha(p.white, 0.1)} 0%, ${fillAlpha(p.white, 0.05)} 40%, transparent 70%)`;
  const pink2Bg = `radial-gradient(ellipse 60% 70% at 50% 50%, ${fillAlpha(p.pink2, 0.08)} 0%, ${fillAlpha(p.pink2, 0.04)} 50%, transparent 70%)`;

  return (
    <div className="relative min-h-screen w-full text-white">
      <div className="fixed inset-0 -z-10 overflow-hidden bg-[#1a1a1a] pointer-events-none">
        <div
          className="absolute w-[120%] h-[120%] -top-[20%] -left-[20%]"
          style={{
            background: pinkBg,
            animation: "blob-drift-1 45s ease-in-out infinite",
            willChange: "transform",
            filter: "blur(60px)",
          }}
        />
        <div
          className="absolute w-[100%] h-[100%] top-[10%] -right-[10%]"
          style={{
            background: whiteBg,
            animation: "blob-drift-2 55s ease-in-out infinite",
            willChange: "transform",
            filter: "blur(80px)",
          }}
        />
        <div
          className="absolute w-[110%] h-[110%] -bottom-[30%] left-[10%]"
          style={{
            background: pink2Bg,
            animation: "blob-drift-3 60s ease-in-out infinite",
            willChange: "transform",
            filter: "blur(70px)",
          }}
        />
        <svg className="absolute inset-0 w-full h-full opacity-[0.02] pointer-events-none">
          <filter id="noise-preview">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.8"
              numOctaves={4}
              stitchTiles="stitch"
            />
          </filter>
          <rect width="100%" height="100%" filter="url(#noise-preview)" />
        </svg>
      </div>

      <div className="relative z-10 mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
        <div>
          <h1 className="text-3xl font-light tracking-tight">Background palette preview</h1>
          <p className="mt-2 text-sm text-white/60">
            Same blobs, same motion, same sizing as the real site — only the colors change. Click a
            palette below.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {palettes.map((palette, i) => (
            <button
              key={palette.name}
              onClick={() => setSelected(i)}
              className={`rounded-lg border px-4 py-3 text-left transition ${
                selected === i
                  ? "border-white/40 bg-white/5"
                  : "border-white/10 hover:border-white/20"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm">{palette.name}</span>
                <div className="flex gap-1.5">
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ background: fillAlpha(palette.pink, 1) }}
                  />
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ background: fillAlpha(palette.white, 1) }}
                  />
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ background: fillAlpha(palette.pink2, 1) }}
                  />
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-white/10 bg-black/40 p-4 text-xs text-white/50 backdrop-blur">
          <p className="mb-2 text-white/70">Sample content:</p>
          <p>
            Channel is an online radio station and creative collective. The blobs drift slowly —
            give it a moment to see motion. Pick the palette that feels right and we&apos;ll apply
            it to the site.
          </p>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/40 p-4 backdrop-blur">
          <p className="mb-3 text-sm text-white/80">Accent swatches (replacing pink #D94099)</p>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div
                className="h-12 w-12 rounded"
                style={{ background: "#DC9B50" }}
              />
              <div className="text-xs">
                <div className="text-white">#DC9B50 — brand accent (new)</div>
                <div className="text-white/50">used in stations, progress bars, brand UI</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div
                className="h-12 w-12 rounded"
                style={{ background: "#E5AB66" }}
              />
              <div className="text-xs">
                <div className="text-white">#E5AB66 — brand accent hover</div>
                <div className="text-white/50">slightly lighter for hover states</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div
                className="h-12 w-12 rounded"
                style={{ background: "#F59E0B" }}
              />
              <div className="text-xs">
                <div className="text-white">Tailwind amber-500 (#F59E0B)</div>
                <div className="text-white/50">used in mockup screens — brighter, more orange</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div
                className="h-12 w-12 rounded"
                style={{ background: "#FCD34D" }}
              />
              <div className="text-xs">
                <div className="text-white">Tailwind amber-300 (#FCD34D)</div>
                <div className="text-white/50">lighter mockup accent</div>
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs text-white/50">
            Note: the brand accent (#DC9B50) and Tailwind&apos;s amber-500 are close but not identical
            — amber-500 is brighter/more orange. If you want them to match exactly, I can switch the
            mockup classes to use #DC9B50 directly.
          </p>
        </div>
      </div>
    </div>
  );
}
