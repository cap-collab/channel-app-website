'use client';

import { useEffect, useRef, useState } from 'react';

interface AudioVisualizerProps {
  isPlaying: boolean;
  barCount?: number;
  className?: string;
}

export function AudioVisualizer({ isPlaying, barCount = 24, className = '' }: AudioVisualizerProps) {
  const [bars, setBars] = useState<number[]>(() => Array(barCount).fill(0.1));
  const animationRef = useRef<number>();
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    if (!isPlaying) {
      // When not playing, show minimal static bars
      setBars(Array(barCount).fill(0.1));
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    // Animate bars with pseudo-random values to simulate audio
    const animate = (timestamp: number) => {
      // Throttle updates to ~30fps for performance
      if (timestamp - lastUpdateRef.current < 33) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }
      lastUpdateRef.current = timestamp;

      setBars(prevBars =>
        prevBars.map((_, i) => {
          // Create wave-like pattern with some randomness
          const baseWave = Math.sin(timestamp / 200 + i * 0.5) * 0.3 + 0.5;
          const randomFactor = Math.random() * 0.4;
          // Bars in the middle tend to be taller (typical audio frequency distribution)
          const centerBias = 1 - Math.abs(i - barCount / 2) / (barCount / 2) * 0.3;
          return Math.min(1, Math.max(0.1, baseWave * centerBias + randomFactor));
        })
      );

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, barCount]);

  return (
    <div className={`flex items-end justify-center gap-[2px] h-12 ${className}`}>
      {bars.map((height, i) => (
        <div
          key={i}
          className="w-1 bg-accent rounded-t transition-all duration-75"
          style={{
            height: `${height * 100}%`,
            opacity: isPlaying ? 0.8 + height * 0.2 : 0.3
          }}
        />
      ))}
    </div>
  );
}
