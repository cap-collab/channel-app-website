'use client';

// 20 thin vertical bars rising from a baseline. Pure CSS animation —
// no audio reactivity, no JS state. Per-bar durations use coprime
// (prime-number) values so the row never realigns into a visible loop.
// Desktop gets a soft backdrop-blur strip behind the bars; mobile
// skips it (stacked-blur perf risk on iOS Safari).
const PRIME_DURATIONS = [
  2.3, 2.9, 3.1, 3.7, 4.1, 4.3, 4.7, 5.3, 5.9, 6.1,
  2.3, 2.9, 3.1, 3.7, 4.1, 4.3, 4.7, 5.3, 5.9, 6.1,
];

export function DancingBars() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[28%] w-4/5 h-10 lg:h-14"
    >
      {/* Frosted-glass backdrop — desktop only. mix-blend-overlay
          keeps it readable over both light and dark images. */}
      <div className="bars-glass-bg hidden lg:block absolute inset-0" />

      {/* Bar row — items-end so bars grow upward from a shared baseline. */}
      <div className="absolute inset-0 flex items-end justify-center" style={{ gap: '3px' }}>
        {PRIME_DURATIONS.map((dur, i) => (
          <span
            key={i}
            className="bars-bar"
            style={{
              animationDuration: `${dur}s`,
              animationDelay: `-${(i * 0.13).toFixed(2)}s`,
            }}
          />
        ))}
      </div>

      <style jsx>{`
        @keyframes bars-equalize {
          0% { transform: scaleY(0.15); }
          100% { transform: scaleY(0.85); }
        }
        .bars-bar {
          width: 2px;
          height: 100%;
          background: rgba(255, 255, 255, 0.10);
          border: 1px solid rgba(255, 255, 255, 0.18);
          transform-origin: bottom;
          animation-name: bars-equalize;
          animation-iteration-count: infinite;
          animation-direction: alternate;
          animation-timing-function: ease-in-out;
        }
        .bars-glass-bg {
          background: rgba(255, 255, 255, 0.02);
        }
        @supports (backdrop-filter: blur(6px)) {
          @media (prefers-reduced-motion: no-preference) {
            .bars-glass-bg {
              backdrop-filter: blur(6px);
              -webkit-backdrop-filter: blur(6px);
            }
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .bars-bar {
            animation: none;
            transform: scaleY(0.5);
          }
        }
      `}</style>
    </div>
  );
}
