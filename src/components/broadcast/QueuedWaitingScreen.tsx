'use client';

import { useEffect, useState } from 'react';

interface QueuedWaitingScreenProps {
  audioStream: MediaStream | null;
  isGoingLive: boolean;        // True when go-live sequence has started
  onCancel: () => void;
  isQueued: boolean;           // True when waiting for room to clear
  slotStartTime?: number;      // Slot start time in ms for countdown
}

export function QueuedWaitingScreen({
  isGoingLive,
  onCancel,
  slotStartTime,
}: QueuedWaitingScreenProps) {
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  // Countdown to slot start time (queued state) or going-live elapsed
  useEffect(() => {
    const update = () => {
      if (isGoingLive) {
        // Going live — count down from 3
        return;
      }
      if (slotStartTime) {
        const remaining = Math.max(0, Math.ceil((slotStartTime - Date.now()) / 1000));
        setSecondsRemaining(remaining);
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isGoingLive, slotStartTime]);

  // Track elapsed time for going-live countdown
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
    const remaining = Math.max(3 - goingLiveElapsed, 0);
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center" style={{
        animation: 'pulse-bg 1s ease-in-out infinite',
        backgroundColor: '#1a1a1a',
      }}>
        <style>{`
          @keyframes pulse-bg {
            0%, 100% { background-color: #1a1a1a; }
            50% { background-color: #2a1a1a; }
          }
        `}</style>
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-4 animate-pulse">
            {remaining > 0
              ? `GOING LIVE IN LESS THAN ${remaining} SECOND${remaining > 1 ? 'S' : ''}`
              : 'Connecting...'}
          </h1>
          <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  // Queued waiting state — same visual style as going-live but with countdown to start time
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{
      backgroundColor: '#1a1a1a',
    }}>
      <div className="text-center max-w-md mx-auto px-6">
        <h1 className="text-3xl font-bold text-white mb-4 animate-pulse">
          {secondsRemaining > 0
            ? `GOING LIVE IN LESS THAN ${secondsRemaining} SECOND${secondsRemaining > 1 ? 'S' : ''}`
            : 'GOING LIVE NOW...'}
        </h1>

        <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-8" />

        <p className="text-gray-400 text-sm mb-6">
          Your audio is connected and ready. You&apos;ll go live automatically.
        </p>

        <button
          onClick={onCancel}
          className="text-gray-500 hover:text-gray-300 text-sm underline transition-colors"
        >
          Cancel Queue
        </button>

        <p className="text-gray-600 text-sm mt-8">
          Have any issue? Check the <a href="https://channel-app.com/streaming-guide" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">setup guide</a> or call Cap at 415 316 3109
        </p>
      </div>
    </div>
  );
}
