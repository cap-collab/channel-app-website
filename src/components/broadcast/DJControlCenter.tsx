'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { BroadcastSlotSerialized, AudioInputMethod, RedChannelChoice } from '@/types/broadcast';
import { ChannelContentClass } from '@/lib/audio-analysis';
import { LiveControlBar } from './LiveControlBar';
import { AudioStatusPanel } from './AudioStatusPanel';
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
  // tipButtonLink / onTipButtonLinkChange: kept in the prop type so existing
  // callers stay valid, but no longer consumed — the "How can people support
  // you?" panel was removed from the control center.
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
  audioChannelPanel?: React.ReactNode; // Stream Optimization panel (pre-live, gear input only)
  redChannelChoice?: RedChannelChoice;     // DJ's Stream Optimization choice (for the status line)
  testResult?: ChannelContentClass | null; // Last audio-check result (for the stereo warning)
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
  audioChannelPanel,
  redChannelChoice,
  testResult,
}: DJControlCenterProps) {
  const [copied, setCopied] = useState(false);
  const [isEnding, setIsEnding] = useState(false);

  // Show vibe — DJ-entered, editable any time. `vibeSavedValue` is the value
  // currently persisted on the slot, so we can show "Saved" vs an active Save.
  const [vibeInput, setVibeInput] = useState(slot?.showVibe ?? '');
  const [vibeSavedValue, setVibeSavedValue] = useState(slot?.showVibe ?? '');
  const [savingVibe, setSavingVibe] = useState(false);
  const [vibeError, setVibeError] = useState<string | null>(null);
  const vibeDirty = vibeInput.trim() !== vibeSavedValue.trim();
  const vibeIsSaved = !vibeDirty && !!vibeSavedValue.trim();

  // Seed from the slot once its showVibe arrives (e.g. slot loads after mount,
  // or a reload after the vibe was already saved). Only seeds when the local
  // field is still untouched, so it never clobbers in-progress edits.
  useEffect(() => {
    const fromSlot = slot?.showVibe ?? '';
    if (fromSlot && !vibeSavedValue && !vibeInput) {
      setVibeSavedValue(fromSlot);
      setVibeInput(fromSlot);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot?.showVibe]);

  const handleSaveVibe = async () => {
    const value = vibeInput.trim();
    if (!value || savingVibe || !vibeDirty) return;
    setSavingVibe(true);
    setVibeError(null);
    try {
      const res = await fetch('/api/broadcast/update-vibe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcastToken, showVibe: value }),
      });
      const data = await res.json();
      if (res.ok && typeof data.showVibe === 'string') {
        setVibeInput(data.showVibe);
        setVibeSavedValue(data.showVibe);
      } else {
        setVibeError(data.error || 'Could not save. Try again.');
      }
    } catch {
      setVibeError('Could not save. Try again.');
    } finally {
      setSavingVibe(false);
    }
  };

  // Stream Optimization panel — the "Change" link on the status line scrolls
  // here and briefly highlights it.
  const audioPanelRef = useRef<HTMLDivElement | null>(null);
  const [highlightPanel, setHighlightPanel] = useState(false);
  const scrollToAudioPanel = () => {
    audioPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightPanel(true);
    setTimeout(() => setHighlightPanel(false), 1200);
  };

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
        isGoingLive={isGoingLive}
        inputMethod={inputMethod}
        isRecordingMode={isRecordingMode}
        redChannelChoice={redChannelChoice}
        testResult={testResult}
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
              redChannelChoice={redChannelChoice}
              testResult={testResult}
              onChangeChannelMode={audioChannelPanel ? scrollToAudioPanel : undefined}
            />

            {/* Stream Optimization — pre-live only, gear input only.
                Renders nothing for screen-share / RTMP / live state.
                The "Change" link on the status line scrolls here + highlights. */}
            <div
              ref={audioPanelRef}
              className={`rounded-xl transition-shadow duration-500 ${
                highlightPanel ? 'ring-2 ring-accent' : 'ring-0'
              }`}
            >
              {audioChannelPanel}
            </div>

            {/* Share Your Stream */}
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

            {/* About this show — DJ-entered vibe, editable any time */}
            {slot && (
              <div className="bg-[#252525] rounded-xl p-4">
                <h3 className="text-gray-400 text-sm font-medium mb-1">
                  About this show
                </h3>
                <p className="text-gray-500 text-xs mb-3">
                  Optional. Share a few words about the mood, direction, or headspace for this broadcast.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={vibeInput}
                    onChange={(e) => { setVibeInput(e.target.value); if (vibeError) setVibeError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && vibeDirty && !savingVibe) { e.preventDefault(); handleSaveVibe(); } }}
                    maxLength={120}
                    className="flex-1 min-w-0 bg-[#1a1a1a] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-white/30"
                  />
                  <button
                    onClick={handleSaveVibe}
                    disabled={!vibeDirty || !vibeInput.trim() || savingVibe}
                    className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg transition-colors text-xs flex-shrink-0"
                  >
                    {savingVibe ? 'Saving...' : vibeIsSaved ? 'Saved' : 'Save'}
                  </button>
                </div>
                <div className="flex items-center justify-between mt-1">
                  {vibeError
                    ? <span className="text-red-400 text-xs">{vibeError}</span>
                    : vibeIsSaved
                      ? <span className="text-green-500 text-xs">Saved</span>
                      : <span />}
                  <span className="text-gray-600 text-xs">{vibeInput.length}/120</span>
                </div>
              </div>
            )}

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
