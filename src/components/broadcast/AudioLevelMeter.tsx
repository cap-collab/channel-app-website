'use client';

import { useAudioLevel } from '@/hooks/useAudioLevel';

interface AudioLevelMeterProps {
  stream: MediaStream | null;
}

export function AudioLevelMeter({ stream }: AudioLevelMeterProps) {
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
    <div className="bg-[#252525] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-400 text-sm">Audio Level</span>
        {stream ? (
          <span className="text-green-400 text-sm">Capturing</span>
        ) : (
          <span className="text-gray-500 text-sm">No audio</span>
        )}
      </div>

      <div className="h-4 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${getGradient()} transition-all duration-75`}
          style={{ width: `${width}%` }}
        />
      </div>

      <div className="flex justify-between mt-1 text-xs text-gray-600">
        <span>-60dB</span>
        <span>-12dB</span>
        <span>0dB</span>
      </div>
    </div>
  );
}
