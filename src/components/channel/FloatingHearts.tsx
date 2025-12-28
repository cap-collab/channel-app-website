'use client';

import { useEffect, useState, useCallback } from 'react';

interface Heart {
  id: number;
  xOffset: number;
  duration: number;
  delay: number;
  size: number;
  waveAmplitude: number;
  waveDirection: number; // 1 or -1 for left/right wave
}

interface FloatingHeartsProps {
  trigger: number;
  color?: string;
}

export function FloatingHearts({ trigger, color = 'var(--accent)' }: FloatingHeartsProps) {
  const [hearts, setHearts] = useState<Heart[]>([]);

  const removeHeart = useCallback((id: number) => {
    setHearts((prev) => prev.filter((h) => h.id !== id));
  }, []);

  useEffect(() => {
    if (trigger === 0) return;

    // Spawn 3 hearts with staggered delays (matching iOS)
    const count = 3;
    for (let i = 0; i < count; i++) {
      const heart: Heart = {
        id: Date.now() + i,
        xOffset: Math.random() * 30 - 15, // -15 to 15
        duration: 1.5 + Math.random() * 0.7, // 1.5 to 2.2s
        delay: i * 0.18, // Staggered timing
        size: 18 + Math.random() * 10, // 18 to 28
        waveAmplitude: 15 + Math.random() * 15, // 15 to 30
        waveDirection: Math.random() > 0.5 ? 1 : -1,
      };

      setTimeout(() => {
        setHearts((prev) => [...prev, heart]);
      }, heart.delay * 1000);
    }
  }, [trigger]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible">
      {hearts.map((heart) => (
        <FloatingHeart
          key={heart.id}
          heart={heart}
          color={color}
          onComplete={() => removeHeart(heart.id)}
        />
      ))}
    </div>
  );
}

function FloatingHeart({
  heart,
  color,
  onComplete,
}: {
  heart: Heart;
  color: string;
  onComplete: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Trigger animation on mount
    requestAnimationFrame(() => setMounted(true));

    // Remove after animation completes
    const timeout = setTimeout(() => {
      onComplete();
    }, heart.duration * 1000 + 100);

    return () => clearTimeout(timeout);
  }, [heart.duration, onComplete]);

  // Calculate wave end position
  const waveEndX = heart.waveAmplitude * heart.waveDirection;

  return (
    <>
      <div
        className={`absolute bottom-0 left-1/2 ${mounted ? 'animate-float' : ''}`}
        style={{
          '--start-x': `${heart.xOffset}px`,
          '--end-x': `${heart.xOffset + waveEndX}px`,
          '--duration': `${heart.duration}s`,
          transform: `translateX(calc(-50% + ${heart.xOffset}px))`,
        } as React.CSSProperties}
      >
        <svg
          className={mounted ? 'animate-heart' : ''}
          style={{
            width: heart.size,
            height: heart.size,
            '--duration': `${heart.duration}s`,
            transform: 'scale(0.3)',
          } as React.CSSProperties}
          fill={color}
          viewBox="0 0 24 24"
        >
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      </div>

      <style jsx>{`
        @keyframes float-up-wave {
          0% {
            transform: translateX(calc(-50% + var(--start-x))) translateY(0);
            opacity: 1;
          }
          25% {
            transform: translateX(calc(-50% + var(--end-x))) translateY(-45px);
            opacity: 1;
          }
          50% {
            transform: translateX(calc(-50% + var(--start-x))) translateY(-90px);
            opacity: 1;
          }
          75% {
            transform: translateX(calc(-50% + var(--end-x))) translateY(-135px);
            opacity: 0.5;
          }
          100% {
            transform: translateX(calc(-50% + var(--start-x))) translateY(-180px);
            opacity: 0;
          }
        }

        @keyframes heart-pop-fade {
          0% {
            transform: scale(0.3);
            opacity: 1;
          }
          15% {
            transform: scale(1.15);
            opacity: 1;
          }
          25% {
            transform: scale(0.95);
            opacity: 1;
          }
          35% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(0.5);
            opacity: 0;
          }
        }

        .animate-float {
          animation: float-up-wave var(--duration) ease-out forwards;
        }

        .animate-heart {
          animation: heart-pop-fade var(--duration) cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
      `}</style>
    </>
  );
}
