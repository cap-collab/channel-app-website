"use client";

import { useState } from "react";

// =============================================================================
// PROD BASELINE — locked. Matches src/components/AnimatedBackground.tsx and the
// .animate-blob-* classes in src/app/globals.css exactly. Don't drift from these
// without also updating prod.
// =============================================================================
const PROD_PINK = "rgba(220, 155, 80, ALPHA)";
const PROD_WHITE = "rgba(235, 215, 175, ALPHA)";
const PROD_PINK2 = "rgba(110, 65, 40, ALPHA)";

function fillAlpha(template: string, a: number) {
  return template.replace("ALPHA", a.toString());
}

// =============================================================================
// WAVE-VISIBILITY VARIANTS — each variant is an extra layer on top of the prod
// blobs (or a swap of the prod blob keyframes) intended to make the breathing
// motion more visible without changing colors.
// =============================================================================
type Variant = {
  name: string;
  description: string;
};

const variants: Variant[] = [
  {
    name: "Baseline (prod, no extra)",
    description: "Exactly what's live today. Use this as your reference.",
  },
  {
    name: "Opacity + scale boost",
    description:
      "Same motion, bigger breath. Opacity swings 0.6→1.0 (was 0.8→1.0) and scale swings up to 1.25 (was 1.10). Each inhale is visibly larger and brighter.",
  },
  {
    name: "Blur tween on inhale",
    description:
      "Blob sharpens on the breath peak then blurs back out. Filter blur tweens 80px↔45px in sync with the breath — your eye reads 'thing getting solid' as motion.",
  },
  {
    name: "Bloom/glow on inhale",
    description:
      "Each blob gets a soft outer glow that brightens on its inhale. Same translation/scale as prod, but the breath becomes a pulsing halo.",
  },
  {
    name: "Shimmer — single drift (cheap)",
    description:
      "Static noise rendered once, then drifts laterally via cheap GPU transform. No SMIL, no per-frame turbulence recalc. Reads as flowing grain.",
  },
  {
    name: "Shimmer — parallax (cheap)",
    description:
      "Two static noise layers drifting in opposite directions at different speeds. Interference reads as fluid current. Still cheap — just two GPU translates.",
  },
];

// =============================================================================
// ADVANCED PLAYGROUND — palette + motion options. Hidden behind a toggle.
// Reuse this when exploring color/motion changes for the whole background.
// =============================================================================
type Palette = {
  name: string;
  pink: string;
  white: string;
  pink2: string;
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
    name: "★ Amber + light sand + chocolate (PROD)",
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

type Motion = {
  name: string;
  description: string;
  keyframes: string;
  blob1: string;
  blob2: string;
  blob3: string;
};

const motions: Motion[] = [
  {
    name: "Drift",
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
    description: "Same shape of motion as current, but on 18–24s loops.",
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
    description: "Slow drift plus a soft opacity heartbeat.",
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
    description: "Each blob sweeps slowly across the viewport in a long curve.",
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
    description: "Each blob breathes at a different rate (7s / 11s / 17s).",
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
    name: "Aurora × Multi-tempo breathing (PROD)",
    description: "Wide aurora sweep + polyrhythmic breathing. This is what's live.",
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

// Prod-matching defaults for the advanced playground
const PROD_PALETTE_IDX = 1;
const PROD_MOTION_IDX = 6;

export default function BgPreviewPage() {
  const [variantIdx, setVariantIdx] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const [paletteIdx, setPaletteIdx] = useState(PROD_PALETTE_IDX);
  const [motionIdx, setMotionIdx] = useState(PROD_MOTION_IDX);

  // ---- Background source: locked prod, OR advanced playground when toggled ----
  const useAdvancedBg = advanced;
  const p = palettes[paletteIdx];
  const m = motions[motionIdx];
  const pb = p.pinkBoost ?? 1;
  const wb = p.whiteBoost ?? 1;
  const p2b = p.pink2Boost ?? 1;

  const pinkBg = useAdvancedBg
    ? `radial-gradient(ellipse 80% 60% at 50% 50%, ${fillAlpha(p.pink, 0.12 * pb)} 0%, ${fillAlpha(p.pink, 0.06 * pb)} 40%, transparent 70%)`
    : `radial-gradient(ellipse 80% 60% at 50% 50%, ${fillAlpha(PROD_PINK, 0.12)} 0%, ${fillAlpha(PROD_PINK, 0.06)} 40%, transparent 70%)`;
  const whiteBg = useAdvancedBg
    ? `radial-gradient(ellipse 70% 80% at 50% 50%, ${fillAlpha(p.white, 0.1 * wb)} 0%, ${fillAlpha(p.white, 0.05 * wb)} 40%, transparent 70%)`
    : `radial-gradient(ellipse 70% 80% at 50% 50%, ${fillAlpha(PROD_WHITE, 0.1)} 0%, ${fillAlpha(PROD_WHITE, 0.05)} 40%, transparent 70%)`;
  const pink2Bg = useAdvancedBg
    ? `radial-gradient(ellipse 60% 70% at 50% 50%, ${fillAlpha(p.pink2, 0.08 * p2b)} 0%, ${fillAlpha(p.pink2, 0.04 * p2b)} 50%, transparent 70%)`
    : `radial-gradient(ellipse 60% 70% at 50% 50%, ${fillAlpha(PROD_PINK2, 0.08)} 0%, ${fillAlpha(PROD_PINK2, 0.04)} 50%, transparent 70%)`;

  // ---- Variant keyframes (only used in the prod-locked view) ----
  const variantCss = `
    /* Variant 0 — prod baseline */
    @keyframes bp-prod-1 {
      0%   { transform: translate(-22%, -8%) scale(1);   opacity: 0.9; }
      50%  { transform: translate(22%, 6%)  scale(1.1);  opacity: 1; }
      100% { transform: translate(-22%, -8%) scale(1);   opacity: 0.9; }
    }
    @keyframes bp-prod-2 {
      0%   { transform: translate(18%, 12%) scale(1.02); opacity: 1; }
      50%  { transform: translate(-18%, -8%) scale(0.94); opacity: 0.8; }
      100% { transform: translate(18%, 12%) scale(1.02); opacity: 1; }
    }
    @keyframes bp-prod-3 {
      0%   { transform: translate(-12%, 18%) scale(0.97); opacity: 0.85; }
      50%  { transform: translate(18%, -12%) scale(1.08); opacity: 1; }
      100% { transform: translate(-12%, 18%) scale(0.97); opacity: 0.85; }
    }
    /* Variant 1 — opacity + scale boost */
    @keyframes bp-boost-1 {
      0%   { transform: translate(-22%, -8%) scale(0.9);  opacity: 0.6; }
      50%  { transform: translate(22%, 6%)  scale(1.25); opacity: 1; }
      100% { transform: translate(-22%, -8%) scale(0.9);  opacity: 0.6; }
    }
    @keyframes bp-boost-2 {
      0%   { transform: translate(18%, 12%) scale(1.1);  opacity: 1; }
      50%  { transform: translate(-18%, -8%) scale(0.8); opacity: 0.55; }
      100% { transform: translate(18%, 12%) scale(1.1);  opacity: 1; }
    }
    @keyframes bp-boost-3 {
      0%   { transform: translate(-12%, 18%) scale(0.85); opacity: 0.55; }
      50%  { transform: translate(18%, -12%) scale(1.2);  opacity: 1; }
      100% { transform: translate(-12%, 18%) scale(0.85); opacity: 0.55; }
    }
    /* Variant 2 — blur tween */
    @keyframes bp-blur-1 {
      0%   { transform: translate(-22%, -8%) scale(1);   opacity: 0.9; filter: blur(60px); }
      50%  { transform: translate(22%, 6%)  scale(1.1); opacity: 1;   filter: blur(35px); }
      100% { transform: translate(-22%, -8%) scale(1);   opacity: 0.9; filter: blur(60px); }
    }
    @keyframes bp-blur-2 {
      0%   { transform: translate(18%, 12%) scale(1.02); opacity: 1;   filter: blur(80px); }
      50%  { transform: translate(-18%, -8%) scale(0.94); opacity: 0.8; filter: blur(45px); }
      100% { transform: translate(18%, 12%) scale(1.02); opacity: 1;   filter: blur(80px); }
    }
    @keyframes bp-blur-3 {
      0%   { transform: translate(-12%, 18%) scale(0.97); opacity: 0.85; filter: blur(70px); }
      50%  { transform: translate(18%, -12%) scale(1.08); opacity: 1;   filter: blur(40px); }
      100% { transform: translate(-12%, 18%) scale(0.97); opacity: 0.85; filter: blur(70px); }
    }
    /* Variant 3 — bloom halos */
    @keyframes bp-bloom-1 { 0%,100% { opacity: 0; } 50% { opacity: 0.55; } }
    @keyframes bp-bloom-2 { 0%,100% { opacity: 0.5; } 50% { opacity: 0; } }
    @keyframes bp-bloom-3 { 0%,100% { opacity: 0; } 50% { opacity: 0.45; } }
    /* Variants 4 & 5 — shimmer drift. Static SVG noise translated laterally; no per-frame turbulence math. */
    @keyframes bp-shimmer-drift-a {
      0%   { transform: translate3d(0%, 0, 0); }
      50%  { transform: translate3d(-12%, -1%, 0); }
      100% { transform: translate3d(0%, 0, 0); }
    }
    @keyframes bp-shimmer-drift-b {
      0%   { transform: translate3d(-12%, -1%, 0); }
      50%  { transform: translate3d(0%, 1%, 0); }
      100% { transform: translate3d(-12%, -1%, 0); }
    }
  `;

  // Pick keyframes for the prod-locked view; bypass them in advanced mode.
  const blob1Anim = useAdvancedBg
    ? m.blob1
    : (() => {
        switch (variantIdx) {
          case 1: return "bp-boost-1 23s ease-in-out infinite";
          case 2: return "bp-blur-1 23s ease-in-out infinite";
          default: return "bp-prod-1 23s ease-in-out infinite";
        }
      })();
  const blob2Anim = useAdvancedBg
    ? m.blob2
    : (() => {
        switch (variantIdx) {
          case 1: return "bp-boost-2 31s ease-in-out infinite";
          case 2: return "bp-blur-2 31s ease-in-out infinite";
          default: return "bp-prod-2 31s ease-in-out infinite";
        }
      })();
  const blob3Anim = useAdvancedBg
    ? m.blob3
    : (() => {
        switch (variantIdx) {
          case 1: return "bp-boost-3 41s ease-in-out infinite";
          case 2: return "bp-blur-3 41s ease-in-out infinite";
          default: return "bp-prod-3 41s ease-in-out infinite";
        }
      })();

  // Blur is keyframe-controlled only on the "blur tween" variant
  const blob1Filter = !useAdvancedBg && variantIdx === 2 ? undefined : "blur(60px)";
  const blob2Filter = !useAdvancedBg && variantIdx === 2 ? undefined : "blur(80px)";
  const blob3Filter = !useAdvancedBg && variantIdx === 2 ? undefined : "blur(70px)";

  return (
    <div className="relative min-h-screen w-full text-white">
      <style>{`${variantCss}${useAdvancedBg ? m.keyframes : ""}`}</style>
      <div className="fixed inset-0 -z-10 overflow-hidden bg-[#1a1a1a] pointer-events-none">
        <div
          className="absolute w-[120%] h-[120%] -top-[20%] -left-[20%]"
          style={{
            background: pinkBg,
            animation: blob1Anim,
            willChange: "transform, opacity, filter",
            filter: blob1Filter,
          }}
        />
        <div
          className="absolute w-[100%] h-[100%] top-[10%] -right-[10%]"
          style={{
            background: whiteBg,
            animation: blob2Anim,
            willChange: "transform, opacity, filter",
            filter: blob2Filter,
          }}
        />
        <div
          className="absolute w-[110%] h-[110%] -bottom-[30%] left-[10%]"
          style={{
            background: pink2Bg,
            animation: blob3Anim,
            willChange: "transform, opacity, filter",
            filter: blob3Filter,
          }}
        />

        {/* Variant 3 — bloom halos */}
        {!useAdvancedBg && variantIdx === 3 && (
          <>
            <div
              className="absolute w-[120%] h-[120%] -top-[20%] -left-[20%]"
              style={{
                background: `radial-gradient(ellipse 70% 50% at 50% 50%, ${fillAlpha(PROD_PINK, 0.22)} 0%, ${fillAlpha(PROD_PINK, 0.08)} 35%, transparent 65%)`,
                filter: "blur(40px)",
                animation: "bp-bloom-1 23s ease-in-out infinite",
                willChange: "opacity",
                mixBlendMode: "screen",
              }}
            />
            <div
              className="absolute w-[100%] h-[100%] top-[10%] -right-[10%]"
              style={{
                background: `radial-gradient(ellipse 60% 70% at 50% 50%, ${fillAlpha(PROD_WHITE, 0.2)} 0%, ${fillAlpha(PROD_WHITE, 0.07)} 35%, transparent 65%)`,
                filter: "blur(50px)",
                animation: "bp-bloom-2 31s ease-in-out infinite",
                willChange: "opacity",
                mixBlendMode: "screen",
              }}
            />
            <div
              className="absolute w-[110%] h-[110%] -bottom-[30%] left-[10%]"
              style={{
                background: `radial-gradient(ellipse 50% 60% at 50% 50%, ${fillAlpha(PROD_PINK2, 0.18)} 0%, ${fillAlpha(PROD_PINK2, 0.06)} 40%, transparent 65%)`,
                filter: "blur(45px)",
                animation: "bp-bloom-3 41s ease-in-out infinite",
                willChange: "opacity",
                mixBlendMode: "screen",
              }}
            />
          </>
        )}

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

        {/* Variant 4 — single-drift shimmer. Static noise, GPU translate only. */}
        {!useAdvancedBg && variantIdx === 4 && (
          <svg
            className="absolute pointer-events-none"
            style={{
              top: "-10%",
              left: "-25%",
              width: "150%",
              height: "120%",
              opacity: 0.08,
              animation: "bp-shimmer-drift-a 45s ease-in-out infinite",
              willChange: "transform",
            }}
          >
            <filter id="noise-shimmer-a">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.014 0.022"
                numOctaves={2}
                stitchTiles="stitch"
              />
              <feColorMatrix type="matrix" values="0 0 0 0 0.86  0 0 0 0 0.7  0 0 0 0 0.45  0 0 0 0.5 0" />
            </filter>
            <rect width="100%" height="100%" filter="url(#noise-shimmer-a)" />
          </svg>
        )}

        {/* Variant 5 — parallax shimmer. Two static noise layers drifting opposite directions. */}
        {!useAdvancedBg && variantIdx === 5 && (
          <>
            <svg
              className="absolute pointer-events-none"
              style={{
                top: "-10%",
                left: "-25%",
                width: "150%",
                height: "120%",
                opacity: 0.07,
                animation: "bp-shimmer-drift-a 50s ease-in-out infinite",
                willChange: "transform",
              }}
            >
              <filter id="noise-shimmer-p1">
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.012 0.02"
                  numOctaves={2}
                  stitchTiles="stitch"
                  seed={1}
                />
                <feColorMatrix type="matrix" values="0 0 0 0 0.86  0 0 0 0 0.7  0 0 0 0 0.45  0 0 0 0.5 0" />
              </filter>
              <rect width="100%" height="100%" filter="url(#noise-shimmer-p1)" />
            </svg>
            <svg
              className="absolute pointer-events-none"
              style={{
                top: "-10%",
                left: "-25%",
                width: "150%",
                height: "120%",
                opacity: 0.05,
                animation: "bp-shimmer-drift-b 32s ease-in-out infinite",
                willChange: "transform",
              }}
            >
              <filter id="noise-shimmer-p2">
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.022 0.014"
                  numOctaves={2}
                  stitchTiles="stitch"
                  seed={7}
                />
                <feColorMatrix type="matrix" values="0 0 0 0 0.92  0 0 0 0 0.85  0 0 0 0 0.7  0 0 0 0.5 0" />
              </filter>
              <rect width="100%" height="100%" filter="url(#noise-shimmer-p2)" />
            </svg>
          </>
        )}
      </div>

      <div className="relative z-10 mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
        <div>
          <h1 className="text-3xl font-light tracking-tight">Background — wave A/B</h1>
          <p className="mt-2 text-sm text-white/60">
            Prod colors and prod motion are locked. Each variant adds an extra layer on top to make
            the breathing more visible.
          </p>
        </div>

        {!advanced && (
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-white/40">Variant</p>
            <div className="flex flex-col gap-2">
              {variants.map((v, i) => (
                <button
                  key={v.name}
                  onClick={() => setVariantIdx(i)}
                  className={`rounded-lg border px-4 py-3 text-left transition ${
                    variantIdx === i
                      ? "border-white/40 bg-white/5"
                      : "border-white/10 hover:border-white/20"
                  }`}
                >
                  <div className="text-sm">{v.name}</div>
                  <div className="mt-0.5 text-xs text-white/50">{v.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-white/10 bg-black/40 p-4 text-xs text-white/50 backdrop-blur">
          <p className="mb-2 text-white/70">Sample content (for legibility check):</p>
          <p>
            Channel is an online radio station and creative collective. Watch the background for at
            least one full breath cycle (~25s) to compare variants fairly.
          </p>
        </div>

        <div>
          <button
            onClick={() => setAdvanced((v) => !v)}
            className="text-xs uppercase tracking-wider text-white/40 hover:text-white/70 transition"
          >
            {advanced ? "▾ Hide advanced playground" : "▸ Show advanced (palette + motion)"}
          </button>
        </div>

        {advanced && (
          <>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wider text-white/40">Motion</p>
              <div className="flex flex-col gap-2">
                {motions.map((mo, i) => (
                  <button
                    key={mo.name}
                    onClick={() => setMotionIdx(i)}
                    className={`rounded-lg border px-4 py-3 text-left transition ${
                      motionIdx === i
                        ? "border-white/40 bg-white/5"
                        : "border-white/10 hover:border-white/20"
                    }`}
                  >
                    <div className="text-sm">{mo.name}</div>
                    <div className="mt-0.5 text-xs text-white/50">{mo.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs uppercase tracking-wider text-white/40">Palette</p>
              <div className="flex flex-col gap-2">
                {palettes.map((palette, i) => (
                  <button
                    key={palette.name}
                    onClick={() => setPaletteIdx(i)}
                    className={`rounded-lg border px-4 py-3 text-left transition ${
                      paletteIdx === i
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
            </div>

            <div className="rounded-lg border border-white/10 bg-black/40 p-4 backdrop-blur">
              <p className="mb-3 text-sm text-white/80">Accent swatches (replacing pink #D94099)</p>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded" style={{ background: "#DC9B50" }} />
                  <div className="text-xs">
                    <div className="text-white">#DC9B50 — brand accent (new)</div>
                    <div className="text-white/50">used in stations, progress bars, brand UI</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded" style={{ background: "#E5AB66" }} />
                  <div className="text-xs">
                    <div className="text-white">#E5AB66 — brand accent hover</div>
                    <div className="text-white/50">slightly lighter for hover states</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded" style={{ background: "#F59E0B" }} />
                  <div className="text-xs">
                    <div className="text-white">Tailwind amber-500 (#F59E0B)</div>
                    <div className="text-white/50">brighter, more orange</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded" style={{ background: "#FCD34D" }} />
                  <div className="text-xs">
                    <div className="text-white">Tailwind amber-300 (#FCD34D)</div>
                    <div className="text-white/50">lighter mockup accent</div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
