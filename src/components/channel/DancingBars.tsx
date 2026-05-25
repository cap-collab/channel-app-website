'use client';

// 100 thin vertical bars rising from a baseline, distributed across
// 80% of the hero width. Pure CSS animation — no audio reactivity,
// no JS state. Per-bar durations cycle through coprime (prime-number)
// values so the row never realigns into a visible loop.
const PRIME_DURATIONS = [2.3, 2.9, 3.1, 3.7, 4.1, 4.3, 4.7, 5.3, 5.9, 6.1];
const BAR_COUNT = 100;

export function DancingBars() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[28%] w-4/5 h-10 lg:h-14"
    >
      {/* Bar row — items-end so bars grow upward from a shared baseline.
          justify-between distributes the 100 bars evenly across the full
          80% container width. */}
      <div className="absolute inset-0 flex items-end justify-between">
        {Array.from({ length: BAR_COUNT }).map((_, i) => (
          <span
            key={i}
            className="bars-bar"
            style={{
              animationDuration: `${PRIME_DURATIONS[i % PRIME_DURATIONS.length]}s`,
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
          background: rgba(255, 255, 255, 0.18);
          transform-origin: bottom;
          animation-name: bars-equalize;
          animation-iteration-count: infinite;
          animation-direction: alternate;
          animation-timing-function: ease-in-out;
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
