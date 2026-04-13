'use client';

import { useAudioLevel } from '@/hooks/useAudioLevel';

interface LiveControlBarProps {
  stream: MediaStream | null;
  isLive: boolean;
  showStartTime?: number; // Unix timestamp ms (kept for prop compatibility)
  isRecordingMode?: boolean; // Show "RECORDING" instead of "LIVE"
  chatUsernameNormalized: string; // kept for prop compatibility
}

export function LiveControlBar({ stream, isLive, isRecordingMode = false }: LiveControlBarProps) {
  const level = useAudioLevel(stream);

  // Convert level to percentage width
  const width = Math.min(level * 100, 100);

  // Determine color based on level
  const getGradient = () => {
    if (level > 0.8) {
      return 'from-green-500 via-yellow-500 to-red-500';
    } else if (level > 0.5) {
      return 'from-green-500 via-yellow-500 to-yellow-500';
    }
    return 'from-green-500 to-green-500';
  };

  return (
    <div className="bg-[#1a1a1a] border-b border-gray-800 px-4 py-3">
      <div className="max-w-6xl mx-auto flex items-center gap-4">
        {/* Status Badge */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full flex-shrink-0 ${
          isLive ? 'bg-red-600' : 'bg-gray-700'
        }`}>
          <div className={`w-2 h-2 rounded-full ${
            isLive ? 'bg-white animate-pulse' : 'bg-gray-400'
          }`} />
          <span className="text-white font-bold text-sm">
            {isLive ? (isRecordingMode ? 'RECORDING' : 'LIVE') : 'READY'}
          </span>
        </div>

        {/* Volume Meter - takes most space */}
        <div className="flex-1 min-w-0">
          <div className="h-6 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full bg-gradient-to-r ${getGradient()} transition-all duration-75`}
              style={{ width: `${width}%` }}
            />
          </div>
          <div className="flex justify-between mt-0.5 text-[10px] text-gray-600">
            <span>-60dB</span>
            <span>-12dB</span>
            <span>0dB</span>
          </div>
        </div>

        {/* Metrics hidden on DJ panel — DJ focus should be on audio monitoring */}
      </div>
    </div>
  );
}
