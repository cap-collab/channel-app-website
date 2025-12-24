'use client';

import { useState, useEffect } from 'react';
import { BroadcastSlotSerialized } from '@/types/broadcast';
import { DJChatPanel } from './DJChatPanel';
import { useAuthContext } from '@/contexts/AuthContext';

// Channel app deep link for the broadcast station
const CHANNEL_BROADCAST_URL = 'https://channel-app.com/listen/broadcast';

interface LiveIndicatorProps {
  slot: BroadcastSlotSerialized | null;
  hlsUrl: string | null;
  onEndBroadcast: () => void;
  broadcastToken?: string;
  djUsername?: string;
}

// Helper to format time
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Helper to format date
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function LiveIndicator({ slot, onEndBroadcast, broadcastToken, djUsername }: LiveIndicatorProps) {
  const { user, isAuthenticated } = useAuthContext();
  const [copied, setCopied] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isEnding, setIsEnding] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);

  // Duration counter and time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setDuration(prev => prev + 1);
      setNow(Date.now());
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

  const copyChannelUrl = async () => {
    try {
      await navigator.clipboard.writeText(CHANNEL_BROADCAST_URL);
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

    const remaining = slot.endTime - now;

    if (remaining <= 0) return 'Overtime';

    const mins = Math.floor(remaining / 60000);
    if (mins < 60) return `${mins}m remaining`;

    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m remaining`;
  };

  const fifteenMin = 15 * 60 * 1000;

  return (
    <div className="space-y-4">
      {/* Show Schedule Header */}
      {slot && (
        <div className="bg-gray-900 rounded-xl p-4">
          <h2 className="text-white font-bold text-lg mb-1">{slot.showName || 'Broadcast'}</h2>
          <p className="text-gray-500 text-sm mb-4">
            {formatDate(slot.startTime)} · {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
          </p>

          {slot.djSlots && slot.djSlots.length > 0 ? (
            <div className="space-y-2">
              {slot.djSlots.map((dj, i) => {
                const isOnNow = dj.startTime <= now && dj.endTime > now;
                const isUpSoon = !isOnNow && dj.startTime > now && (dj.startTime - now) < fifteenMin;
                const minutesUntil = Math.ceil((dj.startTime - now) / 60000);

                return (
                  <div key={i} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-3">
                      <span className="text-white">{dj.djName || 'TBD'}</span>
                      <span className="text-gray-500 text-sm">
                        {formatTime(dj.startTime)} – {formatTime(dj.endTime)}
                      </span>
                    </div>
                    {isOnNow && (
                      <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full font-medium">
                        ON NOW
                      </span>
                    )}
                    {isUpSoon && (
                      <span className="text-xs bg-yellow-600 text-white px-2 py-0.5 rounded-full font-medium">
                        UP IN {minutesUntil} MIN
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : slot.djName ? (
            <div className="flex items-center justify-between py-1">
              <span className="text-white">{slot.djName}</span>
              {slot.startTime <= now && slot.endTime > now && (
                <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full font-medium">
                  ON NOW
                </span>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Live Status Card */}
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
              <p className="text-gray-400 text-sm">{getTimeRemaining()}</p>
            </div>
          )}
        </div>

        {/* Channel App URL */}
        <div className="mb-6">
          <label className="block text-gray-400 text-sm mb-2">Listen in Channel</label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={CHANNEL_BROADCAST_URL}
              className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm"
            />
            <button
              onClick={copyChannelUrl}
              className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-3 rounded-lg transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-gray-500 text-xs mt-2">
            Share this link to open your broadcast in the Channel app
          </p>
        </div>

        {/* End broadcast button */}
        <button
          onClick={handleEndBroadcast}
          disabled={isEnding}
          className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition-colors"
        >
          {isEnding ? 'Ending broadcast...' : 'End Broadcast'}
        </button>
      </div>

      {/* Guest login reminder banner */}
      {!isAuthenticated && djUsername && (
        <div className="bg-blue-900/30 border border-blue-500/30 rounded-xl p-4">
          <p className="text-blue-300 text-sm">
            <span className="font-medium">Want to chat from the Channel app?</span>
            {' '}Log in to link your account.
          </p>
        </div>
      )}

      {/* DJ Chat Panel */}
      {broadcastToken && djUsername && slot && (
        <DJChatPanel
          broadcastToken={broadcastToken}
          slotId={slot.id}
          djUsername={djUsername}
          userId={user?.uid}
          isCollapsed={isChatCollapsed}
          onToggleCollapse={() => setIsChatCollapsed(!isChatCollapsed)}
        />
      )}
    </div>
  );
}
