"use client";

import { useEffect, useState } from "react";

export function AnimatedBackground() {
  // Shimmer is expensive (feTurbulence is CPU-bound, especially on iOS). We
  // skip it entirely on mobile and defer it on desktop until the browser is
  // idle, so the hero and cards paint first.
  const [shimmerReady, setShimmerReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(max-width: 767px)").matches) return;

    type IdleCallback = (cb: () => void, opts?: { timeout: number }) => number;
    const ric: IdleCallback | undefined = (
      window as unknown as { requestIdleCallback?: IdleCallback }
    ).requestIdleCallback;
    const handle = ric
      ? ric(() => setShimmerReady(true), { timeout: 2000 })
      : window.setTimeout(() => setShimmerReady(true), 800);
    return () => {
      if (ric) {
        const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void })
          .cancelIdleCallback;
        cic?.(handle as number);
      } else {
        window.clearTimeout(handle as number);
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#1a1a1a] pointer-events-none">
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

      {/* Parallax shimmer — desktop only, deferred until idle. */}
      {shimmerReady && (
        <>
          <svg
            className="absolute animate-shimmer-a pointer-events-none"
            style={{ top: "-10%", left: "-25%", width: "150%", height: "120%", opacity: 0.07 }}
          >
            <filter id="bg-shimmer-1">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.012 0.02"
                numOctaves={2}
                stitchTiles="stitch"
                seed={1}
              />
              <feColorMatrix type="matrix" values="0 0 0 0 0.86  0 0 0 0 0.7  0 0 0 0 0.45  0 0 0 0.5 0" />
            </filter>
            <rect width="100%" height="100%" filter="url(#bg-shimmer-1)" />
          </svg>
          <svg
            className="absolute animate-shimmer-b pointer-events-none"
            style={{ top: "-10%", left: "-25%", width: "150%", height: "120%", opacity: 0.05 }}
          >
            <filter id="bg-shimmer-2">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.022 0.014"
                numOctaves={2}
                stitchTiles="stitch"
                seed={7}
              />
              <feColorMatrix type="matrix" values="0 0 0 0 0.92  0 0 0 0 0.85  0 0 0 0 0.7  0 0 0 0.5 0" />
            </filter>
            <rect width="100%" height="100%" filter="url(#bg-shimmer-2)" />
          </svg>
        </>
      )}

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
