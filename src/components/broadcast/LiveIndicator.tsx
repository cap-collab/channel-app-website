'use client';

import { useState, useEffect } from 'react';
import { BroadcastSlotSerialized } from '@/types/broadcast';

interface LiveIndicatorProps {
  slot: BroadcastSlotSerialized | null;
  hlsUrl: string | null;
  onEndBroadcast: () => void;
}

export function LiveIndicator({ slot, hlsUrl, onEndBroadcast }: LiveIndicatorProps) {
  const [copied, setCopied] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isEnding, setIsEnding] = useState(false);

  // Duration counter
  useEffect(() => {
    const interval = setInterval(() => {
      setDuration(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const copyHlsUrl = async () => {
    if (!hlsUrl) return;

    try {
      await navigator.clipboard.writeText(hlsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error('Failed to copy');
    }
  };

  const handleEndBroadcast = async () => {
    setIsEnding(true);
    onEndBroadcast();
  };

  // Calculate time remaining if we have a slot
  const getTimeRemaining = () => {
    if (!slot) return null;

    const now = Date.now();
    const endTime = slot.endTime;
    const remaining = endTime - now;

    if (remaining <= 0) return 'Overtime';

    const mins = Math.floor(remaining / 60000);
    if (mins < 60) return `${mins}m remaining`;

    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m remaining`;
  };

  return (
    <div className="bg-gray-900 rounded-xl p-6">
      {/* Live badge and duration */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-red-600 px-3 py-1 rounded-full">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
            <span className="text-white font-bold text-sm">LIVE</span>
          </div>
          <span className="text-white font-mono text-lg">{formatDuration(duration)}</span>
        </div>

        {slot && (
          <div className="text-right">
            <p className="text-white font-medium">{slot.showName || slot.djName}</p>
            <p className="text-gray-400 text-sm">{getTimeRemaining()}</p>
          </div>
        )}
      </div>

      {/* HLS URL */}
      {hlsUrl && (
        <div className="mb-6">
          <label className="block text-gray-400 text-sm mb-2">Stream URL (HLS)</label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={hlsUrl}
              className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm"
            />
            <button
              onClick={copyHlsUrl}
              className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-3 rounded-lg transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-gray-500 text-xs mt-2">
            Share this URL with listeners or use it in your iOS app
          </p>
        </div>
      )}

      {/* End broadcast button */}
      <button
        onClick={handleEndBroadcast}
        disabled={isEnding}
        className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition-colors"
      >
        {isEnding ? 'Ending broadcast...' : 'End Broadcast'}
      </button>
    </div>
  );
}
