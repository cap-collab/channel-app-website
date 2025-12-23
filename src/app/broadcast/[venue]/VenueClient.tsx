'use client';

import { useState, useCallback, useEffect } from 'react';
import { useBroadcast } from '@/hooks/useBroadcast';
import { AudioInputSelector } from '@/components/broadcast/AudioInputSelector';
import { SystemAudioCapture } from '@/components/broadcast/SystemAudioCapture';
import { DeviceAudioCapture } from '@/components/broadcast/DeviceAudioCapture';
import { RtmpIngressPanel } from '@/components/broadcast/RtmpIngressPanel';
import { AudioLevelMeter } from '@/components/broadcast/AudioLevelMeter';
import { LiveIndicator } from '@/components/broadcast/LiveIndicator';
import { AudioInputMethod, BroadcastSlotSerialized } from '@/types/broadcast';
import { getVenueSlots } from '@/lib/broadcast-slots';

interface VenueSlotsResponse {
  currentSlot: BroadcastSlotSerialized | null;
  nextSlot: BroadcastSlotSerialized | null;
}

interface VenueClientProps {
  venueSlug: string;
}

function useVenueSlots() {
  const [data, setData] = useState<VenueSlotsResponse>({ currentSlot: null, nextSlot: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSlots = useCallback(async () => {
    try {
      // Call Firebase client SDK directly instead of API route
      const result = await getVenueSlots();
      setData(result);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch venue slots:', err);
      setError('Failed to fetch venue slots');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSlots();
    // Refresh every 30 seconds
    const interval = setInterval(fetchSlots, 30000);
    return () => clearInterval(interval);
  }, [fetchSlots]);

  return { ...data, loading, error, refetch: fetchSlots };
}

// Helper to get display name for show/DJ
function getDisplayName(slot: BroadcastSlotSerialized): string {
  if (slot.showName) return slot.showName;
  if (slot.djSlots && slot.djSlots.length > 0) {
    const firstDj = slot.djSlots.find(dj => dj.djName);
    return firstDj?.djName || 'Venue Broadcast';
  }
  return slot.djName || 'Venue Broadcast';
}

// Helper to get current DJ from slot
function getCurrentDJ(slot: BroadcastSlotSerialized): string {
  const now = Date.now();

  // Check DJ slots for current time
  if (slot.djSlots && slot.djSlots.length > 0) {
    const currentDjSlot = slot.djSlots.find(
      dj => dj.startTime <= now && dj.endTime > now
    );
    if (currentDjSlot?.djName) return currentDjSlot.djName;

    // If no current DJ, find next one
    const nextDjSlot = slot.djSlots.find(dj => dj.startTime > now);
    if (nextDjSlot?.djName) return nextDjSlot.djName;

    // Return first DJ with a name
    const firstDj = slot.djSlots.find(dj => dj.djName);
    if (firstDj?.djName) return firstDj.djName;
  }

  return slot.djName || 'Venue DJ';
}

export function VenueClient({ venueSlug }: VenueClientProps) {
  const { currentSlot, nextSlot, loading, refetch } = useVenueSlots();

  const participantIdentity = currentSlot ? getCurrentDJ(currentSlot) : 'Venue DJ';
  const broadcast = useBroadcast(participantIdentity, currentSlot?.id);

  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [isGoingLive, setIsGoingLive] = useState(false);

  // DJ change warning state
  const [djChangeWarning, setDjChangeWarning] = useState<{
    type: 'info' | 'warning' | 'urgent' | 'ended';
    message: string;
    subMessage?: string;
  } | null>(null);

  // Check Go Live availability and DJ change warnings
  useEffect(() => {
    if (!currentSlot) return;

    const check = () => {
      const now = Date.now();
      const timeLeft = currentSlot.endTime - now;
      const fifteenMin = 15 * 60 * 1000;
      const oneMin = 60 * 1000;

      if (timeLeft <= 0) {
        // Slot has ended
        if (nextSlot && nextSlot.broadcastType === 'venue') {
          // Next DJ is also venue, auto-refresh
          refetch();
          setDjChangeWarning(null);
        } else {
          // No more venue slots
          setDjChangeWarning({
            type: 'ended',
            message: 'Your slot has ended',
            subMessage: nextSlot
              ? `${getDisplayName(nextSlot)} is broadcasting remotely`
              : 'No more venue slots scheduled',
          });
        }
      } else if (timeLeft <= oneMin) {
        // Less than 1 minute
        const seconds = Math.ceil(timeLeft / 1000);
        setDjChangeWarning({
          type: 'urgent',
          message: `DJ change in ${seconds} second${seconds !== 1 ? 's' : ''}`,
          subMessage: nextSlot ? `${getDisplayName(nextSlot)} is up next` : undefined,
        });
      } else if (timeLeft <= fifteenMin) {
        // Less than 15 minutes
        const minutes = Math.ceil(timeLeft / 60000);
        setDjChangeWarning({
          type: 'warning',
          message: 'DJ Change Coming Up',
          subMessage: nextSlot
            ? `${getDisplayName(nextSlot)} takes over in ${minutes} minute${minutes !== 1 ? 's' : ''}`
            : `Your set ends in ${minutes} minute${minutes !== 1 ? 's' : ''}`,
        });
      } else {
        setDjChangeWarning(null);
      }
    };

    check();
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, [currentSlot, nextSlot, refetch]);

  const handleInputSelect = useCallback((method: AudioInputMethod) => {
    broadcast.setInputMethod(method);
  }, [broadcast]);

  const handleStream = useCallback((stream: MediaStream) => {
    setAudioStream(stream);
  }, []);

  const handleError = useCallback((error: string) => {
    console.error('Capture error:', error);
  }, []);

  const handleBack = useCallback(() => {
    if (audioStream) {
      audioStream.getTracks().forEach(t => t.stop());
      setAudioStream(null);
    }
    broadcast.setInputMethod(null);
  }, [audioStream, broadcast]);

  const handleGoLive = useCallback(async () => {
    if (!audioStream) return;

    setIsGoingLive(true);
    const success = await broadcast.goLive(audioStream);
    setIsGoingLive(false);

    if (!success) {
      console.error('Failed to go live:', broadcast.error);
    }
  }, [audioStream, broadcast]);

  const handleRtmpReady = useCallback(async () => {
    setIsGoingLive(true);
    const connected = await broadcast.connect();
    if (connected) {
      const res = await fetch('/api/livekit/egress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: 'channel-radio' }),
      });
      await res.json();
    }
    setIsGoingLive(false);
  }, [broadcast]);

  const handleEndBroadcast = useCallback(async () => {
    if (audioStream) {
      audioStream.getTracks().forEach(t => t.stop());
      setAudioStream(null);
    }
    await broadcast.endBroadcast();
    broadcast.setInputMethod(null);
  }, [audioStream, broadcast]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-gray-400">Loading venue schedule...</p>
        </div>
      </div>
    );
  }

  // No current slot
  if (!currentSlot) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-8">
        <div className="bg-gray-900 rounded-xl p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-blue-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">No Active Venue Slot</h1>
          <p className="text-gray-400 mb-4">
            There&apos;s no venue broadcast scheduled right now.
          </p>
          {nextSlot && (
            <div className="bg-gray-800 rounded-lg p-4 mt-4">
              <p className="text-gray-400 text-sm">Next up</p>
              <p className="text-white font-medium">{getDisplayName(nextSlot)}</p>
              <p className="text-gray-500 text-sm">
                {new Date(nextSlot.startTime).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const displayName = getDisplayName(currentSlot);
  const currentDJ = getCurrentDJ(currentSlot);

  // Live state
  if (broadcast.isLive) {
    return (
      <div className="min-h-screen bg-black p-8">
        <div className="max-w-lg mx-auto">
          {/* DJ Change Warning Banner */}
          {djChangeWarning && (
            <DjChangeWarningBanner warning={djChangeWarning} onEndBroadcast={handleEndBroadcast} />
          )}
          <LiveIndicator
            slot={currentSlot}
            hlsUrl={broadcast.hlsUrl}
            onEndBroadcast={handleEndBroadcast}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-lg mx-auto">
        {/* Header with current slot info */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-blue-400 text-sm mb-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {venueSlug.charAt(0).toUpperCase() + venueSlug.slice(1)} Broadcast
          </div>
          <h1 className="text-3xl font-bold">Go Live</h1>
          <div className="mt-2">
            <p className="text-gray-400">
              <span className="text-white font-medium">{displayName}</span>
              {currentSlot.showName && currentDJ && currentDJ !== displayName && (
                <span> &bull; {currentDJ}</span>
              )}
            </p>
            <p className="text-gray-500 text-sm">
              {new Date(currentSlot.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - {new Date(currentSlot.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
        </div>

        {/* DJ Change Warning Banner */}
        {djChangeWarning && djChangeWarning.type !== 'ended' && (
          <DjChangeWarningBanner warning={djChangeWarning} />
        )}

        {/* Error display */}
        {broadcast.error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-400">{broadcast.error}</p>
            <button
              onClick={broadcast.clearError}
              className="text-red-300 text-sm underline mt-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Input method selection */}
        {!broadcast.inputMethod && (
          <AudioInputSelector
            onSelect={handleInputSelect}
            disabled={isGoingLive}
          />
        )}

        {/* System audio capture */}
        {broadcast.inputMethod === 'system' && !audioStream && (
          <SystemAudioCapture
            onStream={handleStream}
            onError={handleError}
            onBack={handleBack}
          />
        )}

        {/* Device audio capture */}
        {broadcast.inputMethod === 'device' && !audioStream && (
          <DeviceAudioCapture
            onStream={handleStream}
            onError={handleError}
            onBack={handleBack}
          />
        )}

        {/* RTMP ingress */}
        {broadcast.inputMethod === 'rtmp' && (
          <RtmpIngressPanel
            participantIdentity={participantIdentity}
            onReady={handleRtmpReady}
            onError={handleError}
            onBack={handleBack}
          />
        )}

        {/* Audio captured - show level meter and go live button */}
        {audioStream && (
          <div className="space-y-6">
            <button
              onClick={handleBack}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>

            {/* Show slot timing info */}
            <div className="bg-gray-800 rounded-lg p-4 text-center">
              <p className="text-gray-400 text-sm">Your show</p>
              <p className="text-white font-medium">{displayName}</p>
              <p className="text-gray-400 text-sm">
                {new Date(currentSlot.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - {new Date(currentSlot.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </p>
            </div>

            {/* DJ Change Warning */}
            {djChangeWarning && (
              <DjChangeWarningBanner warning={djChangeWarning} onEndBroadcast={djChangeWarning.type === 'ended' ? handleEndBroadcast : undefined} />
            )}

            <AudioLevelMeter stream={audioStream} />

            <div className="bg-gray-900 rounded-xl p-4">
              <p className="text-gray-400 text-sm mb-4">
                Check your audio levels above to make sure sound is coming through.
                You can test as long as you need &mdash; your broadcast won&apos;t start until you click GO LIVE.
              </p>

              <button
                onClick={handleGoLive}
                disabled={isGoingLive || djChangeWarning?.type === 'ended'}
                className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg text-xl transition-colors"
              >
                {isGoingLive ? 'Going live...' : 'GO LIVE'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// DJ Change Warning Banner Component
function DjChangeWarningBanner({
  warning,
  onEndBroadcast
}: {
  warning: { type: 'info' | 'warning' | 'urgent' | 'ended'; message: string; subMessage?: string };
  onEndBroadcast?: () => void;
}) {
  const bgColor = {
    info: 'bg-blue-900/50 border-blue-700',
    warning: 'bg-yellow-900/50 border-yellow-700',
    urgent: 'bg-red-900/50 border-red-700',
    ended: 'bg-gray-800 border-gray-600',
  }[warning.type];

  const iconColor = {
    info: 'text-blue-400',
    warning: 'text-yellow-400',
    urgent: 'text-red-400',
    ended: 'text-gray-400',
  }[warning.type];

  return (
    <div className={`${bgColor} border rounded-lg p-4 mb-6`}>
      <div className="flex items-start gap-3">
        <div className={iconColor}>
          {warning.type === 'urgent' ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : warning.type === 'ended' ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          )}
        </div>
        <div className="flex-1">
          <p className="text-white font-medium">{warning.message}</p>
          {warning.subMessage && (
            <p className="text-gray-300 text-sm mt-1">{warning.subMessage}</p>
          )}
          {warning.type === 'warning' && (
            <p className="text-gray-400 text-sm mt-2">Prepare to wrap up your set</p>
          )}
          {warning.type === 'urgent' && (
            <p className="text-gray-400 text-sm mt-2">Prepare to hand over</p>
          )}
        </div>
      </div>
      {warning.type === 'ended' && onEndBroadcast && (
        <button
          onClick={onEndBroadcast}
          className="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
        >
          End Broadcast
        </button>
      )}
    </div>
  );
}
