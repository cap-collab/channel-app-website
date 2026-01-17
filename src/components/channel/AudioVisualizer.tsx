'use client';

import { useEffect, useState } from 'react';
import { useAudioLevel } from '@/hooks/useAudioLevel';

interface AudioVisualizerProps {
  className?: string;
  stream?: MediaStream | null;
}

export function AudioVisualizer({ className = '', stream }: AudioVisualizerProps) {
  // Use the same hook as the DJ's LiveControlBar
  const level = useAudioLevel(stream ?? null);
  const [hasEverMoved, setHasEverMoved] = useState(false);

  // Track if the meter has ever shown movement
  useEffect(() => {
    if (level > 0.01) {
      setHasEverMoved(true);
    }
  }, [level]);

  // Don't render if there's no stream or if the meter has never moved
  if (!stream || !hasEverMoved) {
    return null;
  }

  // Convert level to percentage width
  const width = Math.min(level * 100, 100);

  // Determine color based on level - matches DJ's LiveControlBar
  const getGradient = () => {
    if (level > 0.8) {
      return 'from-green-500 via-yellow-500 to-red-500';
    } else if (level > 0.5) {
      return 'from-green-500 via-yellow-500 to-yellow-500';
    }
    return 'from-green-500 to-green-500';
  };

  return (
    <div className={className}>
      <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${getGradient()} transition-all duration-75`}
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="flex justify-between mt-0.5 text-[9px] text-gray-500">
        <span>-60dB</span>
        <span>-12dB</span>
        <span>0dB</span>
      </div>
    </div>
  );
}
