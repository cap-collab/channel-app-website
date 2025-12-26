'use client';

import Image from 'next/image';
import { BroadcastSlotSerialized } from '@/types/broadcast';
import { LoveButton } from './LoveButton';
import { ActivityBadges } from './ActivityBadges';
import { ProgressBar } from './ProgressBar';
import { BPMBadge } from './BPMBadge';
import { useBPM } from '@/contexts/BPMContext';

interface NowPlayingPanelProps {
  isPlaying: boolean;
  isLoading: boolean;
  isLive: boolean;
  currentShow: BroadcastSlotSerialized | null;
  currentDJ: string | null;
  onTogglePlay: () => void;
  loveCount: number;
  listenerCount: number;
  messageCount: number;
  isAuthenticated: boolean;
  username?: string;
  compact?: boolean;
  error?: string | null;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function NowPlayingPanel({
  isPlaying,
  isLoading,
  isLive,
  currentShow,
  currentDJ,
  onTogglePlay,
  loveCount,
  listenerCount,
  messageCount,
  isAuthenticated,
  username,
  compact = false,
  error,
}: NowPlayingPanelProps) {
  // Get BPM data for broadcast station
  const { stationBPM } = useBPM();
  const broadcastBPM = stationBPM['broadcast']?.bpm || null;

  // Station name is always "Channel Broadcast"
  const stationName = 'Channel Broadcast';
  // Show name from current show, or fallback when no show
  const showName = currentShow?.showName || (isLive ? 'Live Now' : 'Offline');
  // DJ name from live DJ or scheduled DJ
  const djName = currentDJ || currentShow?.djName || currentShow?.liveDjUsername;

  // Calculate progress if show is live
  const now = Date.now();
  const progress = currentShow
    ? Math.min(Math.max((now - currentShow.startTime) / (currentShow.endTime - currentShow.startTime), 0), 1)
    : 0;

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        {/* Station logo */}
        <Image
          src="/apple-touch-icon.png"
          alt="Channel"
          width={48}
          height={48}
          className="rounded-lg flex-shrink-0"
        />

        {/* Show info: Station > Show > DJ */}
        <div className="flex-1 min-w-0">
          <p className="text-gray-400 text-xs truncate">{stationName}</p>
          <p className="text-white font-medium truncate">{showName}</p>
          {djName && <p className="text-gray-400 text-sm truncate">{djName}</p>}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4">
          <LoveButton
            isAuthenticated={isAuthenticated}
            username={username}
            showName={showName}
            compact
            disabled={!isLive}
          />

          {/* Play/Pause */}
          <button
            onClick={onTogglePlay}
            disabled={!isLive}
            className="w-10 h-10 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <svg className="w-6 h-6 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : isPlaying ? (
              <svg className="w-6 h-6 text-accent" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-accent ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden">
      <div className="p-4">
        {/* Station header */}
        <div className="flex items-start gap-4 mb-4">
          {/* Logo */}
          <Image
            src="/apple-touch-icon.png"
            alt="Channel"
            width={64}
            height={64}
            className="rounded-lg flex-shrink-0"
          />

          {/* Show info: Station > Show > DJ */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-gray-400 text-sm">{stationName}</h2>
              {isLive && (
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              )}
            </div>
            <p className="text-white text-xl font-semibold truncate">{showName}</p>
            {djName && (
              <p className="text-gray-400 truncate">{djName}</p>
            )}
          </div>

          {/* Activity badges and BPM */}
          <div className="flex flex-col items-end gap-2">
            <ActivityBadges
              listenerCount={listenerCount}
              loveCount={loveCount}
              messageCount={messageCount}
            />
            {isLive && <BPMBadge bpm={broadcastBPM} />}
          </div>
        </div>

        {/* Progress bar with time range below */}
        {currentShow && isLive && (
          <div className="mb-4">
            <ProgressBar progress={progress} />
            <div className="flex items-center justify-between text-sm text-gray-500 mt-1">
              <span>{formatTime(currentShow.startTime)}</span>
              <span>{formatTime(currentShow.endTime)}</span>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-center gap-8">
          {/* Share button */}
          <button
            onClick={() => {
              navigator.share?.({
                title: 'Channel Broadcast',
                text: `Listen to ${showName} on Channel Broadcast`,
                url: window.location.href,
              });
            }}
            className="w-10 h-10 flex items-center justify-center text-white hover:text-accent transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </button>

          {/* Love button */}
          <LoveButton
            isAuthenticated={isAuthenticated}
            username={username}
            showName={showName}
            disabled={!isLive}
          />

          {/* Play/Pause button */}
          <button
            onClick={onTogglePlay}
            disabled={!isLive}
            className="w-14 h-14 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <svg className="w-10 h-10 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : isPlaying ? (
              <svg className="w-10 h-10 text-accent" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-10 h-10 text-accent ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        </div>

        {/* Status messages */}
        {error && (
          <p className="text-center text-red-400 text-sm mt-4">
            {error}
          </p>
        )}
        {!isLive && !error && (
          <p className="text-center text-gray-500 text-sm mt-4">
            No show currently live.
          </p>
        )}
      </div>
    </div>
  );
}
