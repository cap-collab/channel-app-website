"use client";

import { useState } from "react";

type Palette = {
  name: string;
  pink: string;
  white: string;
  pink2: string;
  // Optional opacity multipliers — boost a blob beyond its baseline opacity
  // when the palette is low-contrast and motion needs extra punch.
  pinkBoost?: number;
  whiteBoost?: number;
  pink2Boost?: number;
};

const palettes: Palette[] = [
  {
    name: "★ Sand + amber + chocolate",
    pink: "rgba(220, 195, 155, ALPHA)",
    white: "rgba(220, 155, 80, ALPHA)",
    pink2: "rgba(110, 65, 40, ALPHA)",
  },
  {
    name: "★ Amber + light sand + chocolate",
    pink: "rgba(220, 155, 80, ALPHA)",
    white: "rgba(235, 215, 175, ALPHA)",
    pink2: "rgba(110, 65, 40, ALPHA)",
  },
  {
    name: "★ Amber + light sand + chocolate (more punch)",
    pink: "rgba(220, 155, 80, ALPHA)",
    white: "rgba(240, 220, 180, ALPHA)",
    pink2: "rgba(120, 70, 40, ALPHA)",
    pinkBoost: 1.4,
    whiteBoost: 1.4,
    pink2Boost: 1.5,
  },
  {
    name: "Sand + light sand + chocolate (current pick, baseline)",
    pink: "rgba(196, 150, 95, ALPHA)",
    white: "rgba(230, 210, 170, ALPHA)",
    pink2: "rgba(95, 55, 35, ALPHA)",
  },
  {
    name: "Sand + light sand + chocolate (more contrast)",
    pink: "rgba(180, 130, 75, ALPHA)",
    white: "rgba(240, 220, 180, ALPHA)",
    pink2: "rgba(120, 70, 40, ALPHA)",
  },
  {
    name: "Sand + light sand + chocolate (brighter, more visible)",
    pink: "rgba(196, 150, 95, ALPHA)",
    white: "rgba(245, 225, 185, ALPHA)",
    pink2: "rgba(130, 80, 45, ALPHA)",
    pinkBoost: 1.5,
    whiteBoost: 1.5,
    pink2Boost: 1.6,
  },
  {
    name: "Sand + light sand + chocolate (high contrast + brighter)",
    pink: "rgba(170, 120, 65, ALPHA)",
    white: "rgba(250, 230, 195, ALPHA)",
    pink2: "rgba(140, 80, 45, ALPHA)",
    pinkBoost: 1.5,
    whiteBoost: 1.5,
    pink2Boost: 1.7,
  },
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

type Motion = {
  name: string;
  description: string;
  // CSS injected into the page for this motion's keyframes
  keyframes: string;
  // Animation shorthand applied to each of the 3 blobs
  blob1: string;
  blob2: string;
  blob3: string;
};

const motions: Motion[] = [
  {
    name: "Drift (current)",
    description: "Slow translation, 45–60s loops. Calm and quiet.",
    keyframes: `
      @keyframes bp-drift-1 {
        0%,100% { transform: translate(0%,0%) scale(1) rotate(0deg); }
        25%     { transform: translate(15%,-10%) scale(1.1) rotate(45deg); }
        50%     { transform: translate(-5%,15%) scale(0.95) rotate(90deg); }
        75%     { transform: translate(-15%,-5%) scale(1.05) rotate(135deg); }
      }
      @keyframes bp-drift-2 {
        0%,100% { transform: translate(0%,0%) scale(1) rotate(0deg); }
        25%     { transform: translate(-20%,10%) scale(1.15) rotate(-30deg); }
        50%     { transform: translate(10%,-15%) scale(0.9) rotate(-60deg); }
        75%     { transform: translate(20%,5%) scale(1.1) rotate(-90deg); }
      }
      @keyframes bp-drift-3 {
        0%,100% { transform: translate(0%,0%) scale(1); }
        33%     { transform: translate(-10%,-20%) scale(1.2); }
        66%     { transform: translate(15%,10%) scale(0.85); }
      }
    `,
    blob1: "bp-drift-1 45s ease-in-out infinite",
    blob2: "bp-drift-2 55s ease-in-out infinite",
    blob3: "bp-drift-3 60s ease-in-out infinite",
  },
  {
    name: "Breathing",
    description: "Gentle scale pulses, like inhaling/exhaling. Reads as alive but stays calm.",
    keyframes: `
      @keyframes bp-breathe-1 {
        0%,100% { transform: translate(0%,0%) scale(1); }
        50%     { transform: translate(2%,-3%) scale(1.08); }
      }
      @keyframes bp-breathe-2 {
        0%,100% { transform: translate(0%,0%) scale(1.02); }
        50%     { transform: translate(-3%,2%) scale(0.94); }
      }
      @keyframes bp-breathe-3 {
        0%,100% { transform: translate(0%,0%) scale(0.98); }
        50%     { transform: translate(3%,3%) scale(1.06); }
      }
    `,
    blob1: "bp-breathe-1 9s ease-in-out infinite",
    blob2: "bp-breathe-2 11s ease-in-out infinite",
    blob3: "bp-breathe-3 13s ease-in-out infinite",
  },
  {
    name: "Faster drift",
    description: "Same shape of motion as current, but on 18–24s loops. Restless without being busy.",
    keyframes: `
      @keyframes bp-fast-1 {
        0%,100% { transform: translate(0%,0%) scale(1) rotate(0deg); }
        25%     { transform: translate(10%,-7%) scale(1.06) rotate(20deg); }
        50%     { transform: translate(-4%,10%) scale(0.97) rotate(40deg); }
        75%     { transform: translate(-10%,-4%) scale(1.04) rotate(60deg); }
      }
      @keyframes bp-fast-2 {
        0%,100% { transform: translate(0%,0%) scale(1) rotate(0deg); }
        25%     { transform: translate(-12%,6%) scale(1.08) rotate(-15deg); }
        50%     { transform: translate(6%,-10%) scale(0.95) rotate(-30deg); }
        75%     { transform: translate(12%,4%) scale(1.05) rotate(-45deg); }
      }
      @keyframes bp-fast-3 {
        0%,100% { transform: translate(0%,0%) scale(1); }
        33%     { transform: translate(-7%,-12%) scale(1.1); }
        66%     { transform: translate(10%,7%) scale(0.92); }
      }
    `,
    blob1: "bp-fast-1 18s ease-in-out infinite",
    blob2: "bp-fast-2 22s ease-in-out infinite",
    blob3: "bp-fast-3 24s ease-in-out infinite",
  },
  {
    name: "Pulse opacity",
    description: "Slow drift plus a soft opacity heartbeat. Reads like a glow that fades and returns.",
    keyframes: `
      @keyframes bp-pulse-1 {
        0%,100% { transform: translate(0%,0%) scale(1); opacity: 0.85; }
        50%     { transform: translate(8%,-5%) scale(1.05); opacity: 1; }
      }
      @keyframes bp-pulse-2 {
        0%,100% { transform: translate(0%,0%) scale(1); opacity: 1; }
        50%     { transform: translate(-6%,4%) scale(0.97); opacity: 0.7; }
      }
      @keyframes bp-pulse-3 {
        0%,100% { transform: translate(0%,0%) scale(1); opacity: 0.8; }
        50%     { transform: translate(5%,6%) scale(1.04); opacity: 1; }
      }
    `,
    blob1: "bp-pulse-1 14s ease-in-out infinite",
    blob2: "bp-pulse-2 17s ease-in-out infinite",
    blob3: "bp-pulse-3 12s ease-in-out infinite",
  },
  {
    name: "Aurora flow",
    description: "Each blob sweeps slowly across the viewport in a long curve. Like wind across a horizon.",
    keyframes: `
      @keyframes bp-aurora-1 {
        0%   { transform: translate(-25%,-10%) scale(1) rotate(0deg); }
        50%  { transform: translate(25%,5%) scale(1.1) rotate(20deg); }
        100% { transform: translate(-25%,-10%) scale(1) rotate(0deg); }
      }
      @keyframes bp-aurora-2 {
        0%   { transform: translate(20%,15%) scale(1) rotate(0deg); }
        50%  { transform: translate(-20%,-10%) scale(1.05) rotate(-15deg); }
        100% { transform: translate(20%,15%) scale(1) rotate(0deg); }
      }
      @keyframes bp-aurora-3 {
        0%   { transform: translate(-15%,20%) scale(1); }
        50%  { transform: translate(20%,-15%) scale(1.1); }
        100% { transform: translate(-15%,20%) scale(1); }
      }
    `,
    blob1: "bp-aurora-1 30s ease-in-out infinite",
    blob2: "bp-aurora-2 36s ease-in-out infinite",
    blob3: "bp-aurora-3 42s ease-in-out infinite",
  },
  {
    name: "Multi-tempo breathing",
    description: "Each blob breathes at a different rate (7s / 11s / 17s). Soft polyrhythm — most alive.",
    keyframes: `
      @keyframes bp-multi-1 {
        0%,100% { transform: translate(0%,0%) scale(1); opacity: 0.9; }
        50%     { transform: translate(3%,-2%) scale(1.06); opacity: 1; }
      }
      @keyframes bp-multi-2 {
        0%,100% { transform: translate(0%,0%) scale(1.02); opacity: 1; }
        50%     { transform: translate(-2%,3%) scale(0.95); opacity: 0.8; }
      }
      @keyframes bp-multi-3 {
        0%,100% { transform: translate(0%,0%) scale(0.97); opacity: 0.85; }
        50%     { transform: translate(2%,2%) scale(1.05); opacity: 1; }
      }
    `,
    blob1: "bp-multi-1 7s ease-in-out infinite",
    blob2: "bp-multi-2 11s ease-in-out infinite",
    blob3: "bp-multi-3 17s ease-in-out infinite",
  },
  {
    name: "Aurora × Multi-tempo breathing",
    description: "Each blob sweeps across the viewport on a long arc AND breathes at its own tempo. Wide movement layered with a polyrhythmic pulse — alive, never busy.",
    keyframes: `
      @keyframes bp-aubr-1 {
        0%   { transform: translate(-22%,-8%) scale(1); opacity: 0.9; }
        50%  { transform: translate(22%,6%) scale(1.1); opacity: 1; }
        100% { transform: translate(-22%,-8%) scale(1); opacity: 0.9; }
      }
      @keyframes bp-aubr-2 {
        0%   { transform: translate(18%,12%) scale(1.02); opacity: 1; }
        50%  { transform: translate(-18%,-8%) scale(0.94); opacity: 0.8; }
        100% { transform: translate(18%,12%) scale(1.02); opacity: 1; }
      }
      @keyframes bp-aubr-3 {
        0%   { transform: translate(-12%,18%) scale(0.97); opacity: 0.85; }
        50%  { transform: translate(18%,-12%) scale(1.08); opacity: 1; }
        100% { transform: translate(-12%,18%) scale(0.97); opacity: 0.85; }
      }
    `,
    blob1: "bp-aubr-1 23s ease-in-out infinite",
    blob2: "bp-aubr-2 31s ease-in-out infinite",
    blob3: "bp-aubr-3 41s ease-in-out infinite",
  },
];

export default function BgPreviewPage() {
  const [selected, setSelected] = useState(0);
  const [motionIdx, setMotionIdx] = useState(0);
  const p = palettes[selected];
  const motion = motions[motionIdx];

  const pb = p.pinkBoost ?? 1;
  const wb = p.whiteBoost ?? 1;
  const p2b = p.pink2Boost ?? 1;
  const pinkBg = `radial-gradient(ellipse 80% 60% at 50% 50%, ${fillAlpha(p.pink, 0.12 * pb)} 0%, ${fillAlpha(p.pink, 0.06 * pb)} 40%, transparent 70%)`;
  const whiteBg = `radial-gradient(ellipse 70% 80% at 50% 50%, ${fillAlpha(p.white, 0.1 * wb)} 0%, ${fillAlpha(p.white, 0.05 * wb)} 40%, transparent 70%)`;
  const pink2Bg = `radial-gradient(ellipse 60% 70% at 50% 50%, ${fillAlpha(p.pink2, 0.08 * p2b)} 0%, ${fillAlpha(p.pink2, 0.04 * p2b)} 50%, transparent 70%)`;

  return (
    <div className="relative min-h-screen w-full text-white">
      <style>{motion.keyframes}</style>
      <div className="fixed inset-0 -z-10 overflow-hidden bg-[#1a1a1a] pointer-events-none">
        <div
          className="absolute w-[120%] h-[120%] -top-[20%] -left-[20%]"
          style={{
            background: pinkBg,
            animation: motion.blob1,
            willChange: "transform, opacity",
            filter: "blur(60px)",
          }}
        />
        <div
          className="absolute w-[100%] h-[100%] top-[10%] -right-[10%]"
          style={{
            background: whiteBg,
            animation: motion.blob2,
            willChange: "transform, opacity",
            filter: "blur(80px)",
          }}
        />
        <div
          className="absolute w-[110%] h-[110%] -bottom-[30%] left-[10%]"
          style={{
            background: pink2Bg,
            animation: motion.blob3,
            willChange: "transform, opacity",
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
          <h1 className="text-3xl font-light tracking-tight">Background preview</h1>
          <p className="mt-2 text-sm text-white/60">
            Pick a motion and a palette independently — the background updates live. Same blobs,
            same sizing as the real site.
          </p>
        </div>

        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-white/40">Motion</p>
          <div className="flex flex-col gap-2">
            {motions.map((m, i) => (
              <button
                key={m.name}
                onClick={() => setMotionIdx(i)}
                className={`rounded-lg border px-4 py-3 text-left transition ${
                  motionIdx === i
                    ? "border-white/40 bg-white/5"
                    : "border-white/10 hover:border-white/20"
                }`}
              >
                <div className="text-sm">{m.name}</div>
                <div className="mt-0.5 text-xs text-white/50">{m.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-white/40">Palette</p>
        </div>

        <div className="flex flex-col gap-2 -mt-6">
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
