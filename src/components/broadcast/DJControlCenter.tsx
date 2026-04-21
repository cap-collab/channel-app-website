'use client';

import { useState, useMemo } from 'react';
import { BroadcastSlotSerialized, AudioInputMethod } from '@/types/broadcast';
import { LiveControlBar } from './LiveControlBar';
import { AudioStatusPanel } from './AudioStatusPanel';
import { BroadcastSettingsPanel } from './BroadcastSettingsPanel';
import { DJProfileChatPanel } from '@/components/dj-profile/DJProfileChatPanel';


interface DJControlCenterProps {
  slot: BroadcastSlotSerialized | null;
  audioStream: MediaStream | null;
  inputMethod: AudioInputMethod | null;
  isLive: boolean;
  isPublishing: boolean;
  canGoLive: boolean;
  goLiveMessage?: string;
  onGoLive: () => void;
  isGoingLive: boolean;
  onEndBroadcast: () => void;
  broadcastToken: string;
  djUsername: string;
  userId?: string;
  tipButtonLink?: string;
  onTipButtonLinkChange?: (link: string) => void;
  isVenue?: boolean;
  onChangeUsername?: (newUsername: string) => void;
  onChangeAudioSetup?: () => void;
  onChangeSource?: () => void;
  audioSourceLabel?: string | null;
  isRecordingMode?: boolean; // Recording-only mode (no live streaming)
  djEmail?: string; // DJ's email for tips
  roomOccupied?: boolean;    // Previous DJ still broadcasting
  roomFreeAt?: number | null; // When the previous DJ's slot ends (Unix ms)
  onQueueGoLive?: () => void; // Queue to auto go-live when room clears
}

export function DJControlCenter({
  slot,
  audioStream,
  inputMethod,
  isLive,
  isPublishing,
  canGoLive,
  goLiveMessage,
  onGoLive,
  isGoingLive,
  onEndBroadcast,
  broadcastToken,
  djUsername,
  userId,
  tipButtonLink,
  onTipButtonLinkChange,
  isVenue = false,
  onChangeUsername,
  onChangeAudioSetup,
  onChangeSource,
  audioSourceLabel,
  isRecordingMode = false,
  djEmail,
  roomOccupied = false,
  roomFreeAt,
  onQueueGoLive,
}: DJControlCenterProps) {
  const [copied, setCopied] = useState(false);
  const [isEnding, setIsEnding] = useState(false);

  const chatUsernameNormalized = useMemo(() => {
    return djUsername.replace(/[\s-]+/g, '').toLowerCase();
  }, [djUsername]);

  const shareUrl = "https://channel-app.com";

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
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

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex flex-col">
      {/* Top Control Bar - always visible, sticky */}
      <LiveControlBar
        stream={audioStream}
        isLive={isLive}
        inputMethod={inputMethod}
        isRecordingMode={isRecordingMode}
      />

      {/* Main Content — single column: audio first, then tip/share, then compact chat at bottom */}
      <div className="flex-1 p-4 lg:p-6">
        <div className="max-w-3xl mx-auto h-full">
          <div className="space-y-4">
            {/* Audio System */}
            <AudioStatusPanel
              inputMethod={inputMethod}
              stream={audioStream}
              isLive={isLive}
              isPublishing={isPublishing}
              canGoLive={canGoLive}
              goLiveMessage={goLiveMessage}
              onGoLive={onGoLive}
              isGoingLive={isGoingLive}
              onChangeAudioSetup={onChangeAudioSetup}
              onChangeSource={onChangeSource}
              audioSourceLabel={audioSourceLabel}
              isRecordingMode={isRecordingMode}
              roomOccupied={roomOccupied}
              roomFreeAt={roomFreeAt}
              onQueueGoLive={onQueueGoLive}
              slotStartTime={slot?.startTime}
              slotEndTime={slot?.endTime}
              showName={slot?.showName}
            />

            {/* Tip + Share side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <BroadcastSettingsPanel
                broadcastToken={broadcastToken}
                tipButtonLink={tipButtonLink}
                onTipButtonLinkChange={onTipButtonLinkChange}
              />

              <div className="bg-[#252525] rounded-xl p-4">
                <h3 className="text-gray-400 text-sm font-medium mb-3">
                  Share Your Stream
                </h3>
                <div className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-gray-400 flex-shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  <span className="flex-1 min-w-0 text-white font-mono text-sm truncate">
                    {shareUrl}
                  </span>
                  <button
                    onClick={copyShareUrl}
                    className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg transition-colors text-xs flex-shrink-0"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <svg
                    className="w-4 h-4 text-gray-400 flex-shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                  </svg>
                  <a
                    href="https://www.instagram.com/channelrad.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white text-sm underline hover:text-gray-300"
                  >
                    @channelrad.io
                  </a>
                </div>
              </div>
            </div>

            {/* Chat — secondary; aligned with tip/share widgets. Fixed height so it
                doesn't dominate the page. DJ focus should stay on audio monitoring. */}
            {slot && (
              <div className="bg-[#252525] rounded-xl overflow-hidden h-80">
                <DJProfileChatPanel
                  chatUsernameNormalized={chatUsernameNormalized}
                  djUserId={userId || ''}
                  djUsername={djUsername}
                  djEmail={djEmail || ''}
                  isAuthenticated={!!userId || !!broadcastToken}
                  username={djUsername}
                  userId={userId}
                  isOwner={true}
                  broadcastToken={isRecordingMode ? undefined : broadcastToken}
                  broadcastSlotId={slot.id}
                  isVenue={isVenue}
                  onChangeUsername={onChangeUsername}
                  currentShowStartTime={slot.startTime}
                />
              </div>
            )}

            {/* End Broadcast/Recording — subdued; the top bar already conveys live state */}
            {isLive && (
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleEndBroadcast}
                  disabled={isEnding}
                  className="text-red-400 hover:text-red-300 hover:bg-red-900/20 disabled:text-red-800 disabled:cursor-not-allowed text-sm font-medium py-2 px-4 rounded-lg border border-red-900/40 hover:border-red-700 transition-colors"
                >
                  {isEnding
                    ? (isRecordingMode ? 'Ending recording...' : 'Ending broadcast...')
                    : (isRecordingMode ? 'End Recording' : 'End Broadcast')}
                </button>
              </div>
            )}
          </div>
          <p className="text-gray-500 text-sm text-center mt-4">
            Have any issue? Check the <a href="https://channel-app.com/streaming-guide" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">setup guide</a> or call Cap at 415 316 3109
          </p>
        </div>
      </div>
    </div>
  );
}
