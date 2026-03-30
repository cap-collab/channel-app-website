'use client';

import { useEffect, useState } from 'react';
import { AudioLevelMeter } from './AudioLevelMeter';

interface QueuedWaitingScreenProps {
  audioStream: MediaStream | null;
  isGoingLive: boolean;        // True when go-live sequence has started
  onCancel: () => void;
  isQueued: boolean;           // True when waiting for room to clear (not yet from queue path)
}

export function QueuedWaitingScreen({
  audioStream,
  isGoingLive,
  onCancel,
}: QueuedWaitingScreenProps) {
  // Track elapsed time since "going live" started for fallback copy
  const [goingLiveElapsed, setGoingLiveElapsed] = useState(0);

  useEffect(() => {
    if (!isGoingLive) {
      setGoingLiveElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      setGoingLiveElapsed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isGoingLive]);

  // Going live state — room cleared, backend working
  if (isGoingLive) {
    return (
      <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center animate-pulse-bg">
        <style jsx>{`
          @keyframes pulse-bg {
            0%, 100% { background-color: #1a1a1a; }
            50% { background-color: #2a1a1a; }
          }
          .animate-pulse-bg {
            animation: pulse-bg 1s ease-in-out infinite;
          }
        `}</style>
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-4 animate-pulse">
            {goingLiveElapsed < 5
              ? 'GOING LIVE IN LESS THAN 5 SECONDS'
              : 'Connecting...'}
          </h1>
          <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  // Queued waiting state — room still occupied
  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-6">
        <h1 className="text-2xl font-bold text-white mb-2">You are queued</h1>
        <p className="text-xl text-gray-300 mb-8">
          You will go live in less than a minute
        </p>

        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-8" />

        <div className="bg-[#252525] rounded-xl p-4 mb-8">
          <p className="text-gray-400 text-sm mb-3">Your audio is connected and ready</p>
          {audioStream && (
            <AudioLevelMeter stream={audioStream} />
          )}
        </div>

        <p className="text-gray-500 text-sm mb-6">
          You&apos;ll go live automatically when the room clears.
        </p>

        <button
          onClick={onCancel}
          className="text-gray-500 hover:text-gray-300 text-sm underline transition-colors"
        >
          Cancel Queue
        </button>

        <p className="text-gray-600 text-sm mt-8">
          Have any issue? Call Cap at 415 316 3109
        </p>
      </div>
    </div>
  );
}
