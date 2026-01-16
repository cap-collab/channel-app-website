'use client';

import { useEffect, useRef, useState } from 'react';

interface AudioVisualizerProps {
  className?: string;
}

export function AudioVisualizer({ className = '' }: AudioVisualizerProps) {
  const [level, setLevel] = useState(0);
  const [peakLevel, setPeakLevel] = useState(0);
  const animationRef = useRef<number>();
  const lastUpdateRef = useRef<number>(0);
  const peakHoldRef = useRef<number>(0);
  const peakDecayRef = useRef<number>(0);

  // Always animate when component is mounted (it's only rendered when live)
  useEffect(() => {
    const animate = (timestamp: number) => {
      // Throttle updates to ~30fps
      if (timestamp - lastUpdateRef.current < 33) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }
      lastUpdateRef.current = timestamp;

      // Simulate audio level with smooth transitions
      const baseLevel = Math.sin(timestamp / 300) * 0.2 + 0.5;
      const randomBurst = Math.random() > 0.85 ? Math.random() * 0.3 : 0;
      const newLevel = Math.min(1, Math.max(0.1, baseLevel + randomBurst + Math.random() * 0.2));

      setLevel(newLevel);

      // Peak hold logic
      if (newLevel > peakDecayRef.current) {
        peakDecayRef.current = newLevel;
        peakHoldRef.current = timestamp;
        setPeakLevel(newLevel);
      } else if (timestamp - peakHoldRef.current > 1000) {
        // Decay peak after 1 second hold
        peakDecayRef.current = Math.max(0, peakDecayRef.current - 0.02);
        setPeakLevel(peakDecayRef.current);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Convert level to dB display (-60 to 0 dB range)
  const levelDb = level > 0 ? Math.max(-60, 20 * Math.log10(level)) : -60;
  const levelPercent = ((levelDb + 60) / 60) * 100;
  const peakPercent = peakLevel > 0 ? ((Math.max(-60, 20 * Math.log10(peakLevel)) + 60) / 60) * 100 : 0;

  // dB markers
  const dbMarkers = [-48, -36, -24, -12, -6, 0];

  return (
    <div className={`space-y-1 ${className}`}>
      {/* Level bar */}
      <div className="relative h-3 bg-gray-800 rounded-full overflow-hidden">
        {/* Gradient fill - white to pink */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-75"
          style={{
            width: `${levelPercent}%`,
            background: 'linear-gradient(to right, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.7) 50%, #D94099 85%, #ff4080 100%)',
          }}
        />
        {/* Peak indicator */}
        {peakPercent > 0 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-accent transition-all duration-75"
            style={{ left: `${peakPercent}%` }}
          />
        )}
      </div>

      {/* dB scale markers */}
      <div className="relative h-3 flex items-center">
        {dbMarkers.map((db) => {
          const position = ((db + 60) / 60) * 100;
          return (
            <div
              key={db}
              className="absolute flex flex-col items-center"
              style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
            >
              <span className="text-[9px] text-gray-500">{db}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
