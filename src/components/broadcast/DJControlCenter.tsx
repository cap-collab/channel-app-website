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

  const shareUrl = `https://channel-app.com/dj/${encodeURIComponent(djUsername)}`;

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
      {/* Top Control Bar - always visible */}
      <LiveControlBar
        stream={audioStream}
        isLive={isLive}
        showStartTime={slot?.startTime}
        isRecordingMode={isRecordingMode}
        chatUsernameNormalized={chatUsernameNormalized}
      />

      {/* Main Content */}
      <div className="flex-1 p-4 lg:p-6">
        <div className="max-w-6xl mx-auto h-full">
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:h-[calc(100vh-8rem)]">
            {/* Left Column - Controls */}
            <div className="flex-1 space-y-4 lg:overflow-y-auto">
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
              />

              {/* Broadcast Settings */}
              <BroadcastSettingsPanel
                broadcastToken={broadcastToken}
                djUsername={djUsername}
                tipButtonLink={tipButtonLink}
                onTipButtonLinkChange={onTipButtonLinkChange}
              />

              {/* Share URL */}
              <div className="bg-[#252525] rounded-xl p-4">
                <h3 className="text-gray-400 text-sm font-medium mb-3">
                  Share Your Profile
                </h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm"
                  />
                  <button
                    onClick={copyShareUrl}
                    className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors text-sm"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-gray-600 text-xs mt-2">
                  Share your DJ profile with friends and followers
                </p>
              </div>

              {/* End Broadcast/Recording - only show when live */}
              {isLive && (
                <div className="bg-[#252525] rounded-xl p-4">
                  <button
                    onClick={handleEndBroadcast}
                    disabled={isEnding}
                    className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-colors"
                  >
                    {isEnding
                      ? (isRecordingMode ? 'Ending recording...' : 'Ending broadcast...')
                      : (isRecordingMode ? 'End Recording' : 'End Broadcast')}
                  </button>
                </div>
              )}
            </div>

            {/* Right Column - Chat */}
            {slot && (
              <div className="lg:w-96 lg:flex-shrink-0 lg:h-full lg:min-h-0 flex flex-col overflow-hidden">
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
          </div>
          <p className="text-gray-500 text-sm text-center mt-4">
            Have any issue? Check the <a href="https://channel-app.com/streaming-guide" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">setup guide</a> or call Cap at 415 316 3109
          </p>
        </div>
      </div>
    </div>
  );
}
