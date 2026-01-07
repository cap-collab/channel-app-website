"use client";

export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#1a1a1a]">
      {/* Pink blob - top left area */}
      <div
        className="absolute w-[120%] h-[120%] -top-[20%] -left-[20%] animate-blob-pink"
      />

      {/* White blob - center right area */}
      <div
        className="absolute w-[100%] h-[100%] top-[10%] -right-[10%] animate-blob-white"
      />

      {/* Second pink blob - bottom area */}
      <div
        className="absolute w-[110%] h-[110%] -bottom-[30%] left-[10%] animate-blob-pink-2"
      />

      {/* Subtle noise texture overlay */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.02] pointer-events-none">
        <filter id="noise">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.8"
            numOctaves="4"
            stitchTiles="stitch"
          />
        </filter>
        <rect width="100%" height="100%" filter="url(#noise)" />
      </svg>
    </div>
  );
}
