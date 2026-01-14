'use client';

import { useState } from 'react';
import { BroadcastSlotSerialized, AudioInputMethod } from '@/types/broadcast';
import { LiveControlBar } from './LiveControlBar';
import { AudioStatusPanel } from './AudioStatusPanel';
import { BroadcastSettingsPanel } from './BroadcastSettingsPanel';
import { DJChatPanel } from './DJChatPanel';

// Channel app deep link for the broadcast station
const CHANNEL_BROADCAST_URL = 'https://channel-app.com/channel';

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
  tipTotalCents: number;
  tipCount: number;
  promoText?: string;
  promoHyperlink?: string;
  thankYouMessage?: string;
  onPromoChange?: (text: string, hyperlink: string) => void;
  onThankYouChange?: (message: string) => void;
  isVenue?: boolean;
  onChangeUsername?: (newUsername: string) => void;
  initialPromoSubmitted?: boolean;
  onChangeAudioSetup?: () => void;
  onChangeSource?: () => void;
  audioSourceLabel?: string | null;
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
  tipTotalCents,
  tipCount,
  promoText,
  promoHyperlink,
  thankYouMessage,
  onPromoChange,
  onThankYouChange,
  isVenue = false,
  onChangeUsername,
  initialPromoSubmitted = false,
  onChangeAudioSetup,
  onChangeSource,
  audioSourceLabel,
}: DJControlCenterProps) {
  const [copied, setCopied] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);

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

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex flex-col">
      {/* Top Control Bar - always visible */}
      <LiveControlBar
        stream={audioStream}
        isLive={isLive}
        tipTotalCents={tipTotalCents}
        tipCount={tipCount}
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
              />

              {/* Broadcast Settings */}
              <BroadcastSettingsPanel
                broadcastToken={broadcastToken}
                djUsername={djUsername}
                userId={userId}
                promoText={promoText}
                promoHyperlink={promoHyperlink}
                thankYouMessage={thankYouMessage}
                onPromoChange={onPromoChange}
                onThankYouChange={onThankYouChange}
              />

              {/* Share URL */}
              <div className="bg-[#252525] rounded-xl p-4">
                <h3 className="text-gray-400 text-sm font-medium mb-3">Share Your Stream</h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={CHANNEL_BROADCAST_URL}
                    className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm"
                  />
                  <button
                    onClick={copyChannelUrl}
                    className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors text-sm"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-gray-600 text-xs mt-2">
                  Share this link for listeners to tune in via the Channel app
                </p>
              </div>

              {/* End Broadcast - only show when live */}
              {isLive && (
                <div className="bg-[#252525] rounded-xl p-4">
                  <button
                    onClick={handleEndBroadcast}
                    disabled={isEnding}
                    className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-colors"
                  >
                    {isEnding ? 'Ending broadcast...' : 'End Broadcast'}
                  </button>
                </div>
              )}
            </div>

            {/* Right Column - Chat */}
            {slot && (
              <div className="lg:w-96 lg:flex-shrink-0 lg:h-full flex flex-col overflow-hidden">
                <DJChatPanel
                  broadcastToken={broadcastToken}
                  slotId={slot.id}
                  djUsername={djUsername}
                  userId={userId}
                  isCollapsed={isChatCollapsed}
                  onToggleCollapse={() => setIsChatCollapsed(!isChatCollapsed)}
                  initialPromoSubmitted={initialPromoSubmitted}
                  isVenue={isVenue}
                  onChangeUsername={onChangeUsername}
                  activePromoText={promoText}
                  activePromoHyperlink={promoHyperlink}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
