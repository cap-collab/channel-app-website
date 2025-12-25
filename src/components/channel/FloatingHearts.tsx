'use client';

import { useEffect, useState } from 'react';

interface Heart {
  id: number;
  x: number;
  delay: number;
}

interface FloatingHeartsProps {
  trigger: number;
  color?: string;
}

export function FloatingHearts({ trigger, color = 'var(--accent)' }: FloatingHeartsProps) {
  const [hearts, setHearts] = useState<Heart[]>([]);

  useEffect(() => {
    if (trigger === 0) return;

    // Add new hearts
    const newHearts: Heart[] = Array.from({ length: 5 }, (_, i) => ({
      id: Date.now() + i,
      x: Math.random() * 40 - 20, // -20 to 20
      delay: i * 0.1,
    }));

    setHearts((prev) => [...prev, ...newHearts]);

    // Remove hearts after animation
    const timeout = setTimeout(() => {
      setHearts((prev) => prev.filter((h) => !newHearts.find((n) => n.id === h.id)));
    }, 2000);

    return () => clearTimeout(timeout);
  }, [trigger]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {hearts.map((heart) => (
        <div
          key={heart.id}
          className="absolute bottom-0 left-1/2 animate-float-up"
          style={{
            transform: `translateX(${heart.x}px)`,
            animationDelay: `${heart.delay}s`,
          }}
        >
          <svg
            className="w-6 h-6"
            fill={color}
            viewBox="0 0 24 24"
          >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        </div>
      ))}

      <style jsx>{`
        @keyframes float-up {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-100px) scale(1.5);
          }
        }
        .animate-float-up {
          animation: float-up 1.5s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
