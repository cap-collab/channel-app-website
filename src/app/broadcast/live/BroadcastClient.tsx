'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useBroadcastToken } from '@/hooks/useBroadcastToken';
import { useBroadcast } from '@/hooks/useBroadcast';
import { AudioInputSelector } from '@/components/broadcast/AudioInputSelector';
import { SystemAudioCapture } from '@/components/broadcast/SystemAudioCapture';
import { DeviceAudioCapture } from '@/components/broadcast/DeviceAudioCapture';
import { RtmpIngressPanel } from '@/components/broadcast/RtmpIngressPanel';
import { AudioLevelMeter } from '@/components/broadcast/AudioLevelMeter';
import { LiveIndicator } from '@/components/broadcast/LiveIndicator';
import { AudioInputMethod } from '@/types/broadcast';

export function BroadcastClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const { slot, error: tokenError, loading: tokenLoading, scheduleStatus, message } = useBroadcastToken(token);

  const participantIdentity = slot?.djName || 'DJ';
  const broadcast = useBroadcast(participantIdentity, slot?.id);

  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [dismissedWarning, setDismissedWarning] = useState(false);
  const [isGoingLive, setIsGoingLive] = useState(false);
  const [canGoLive, setCanGoLive] = useState(false);
  const [goLiveMessage, setGoLiveMessage] = useState('');

  // Check Go Live availability based on slot timing
  useEffect(() => {
    if (!slot) return;

    const checkGoLiveAvailability = () => {
      const now = Date.now();
      const oneMinuteBefore = slot.startTime - 60 * 1000;

      if (now >= oneMinuteBefore && now <= slot.endTime) {
        setCanGoLive(true);
        setGoLiveMessage('');
      } else if (now < oneMinuteBefore) {
        setCanGoLive(false);
        const availableTime = new Date(oneMinuteBefore).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        setGoLiveMessage(`GO LIVE will be available at ${availableTime}`);
      } else {
        setCanGoLive(false);
        setGoLiveMessage('Your slot has ended');
      }
    };

    checkGoLiveAvailability();
    const interval = setInterval(checkGoLiveAvailability, 1000);
    return () => clearInterval(interval);
  }, [slot]);

  const handleInputSelect = useCallback((method: AudioInputMethod) => {
    broadcast.setInputMethod(method);
  }, [broadcast]);

  const handleStream = useCallback((stream: MediaStream) => {
    setAudioStream(stream);
  }, []);

  const handleError = useCallback((error: string) => {
    console.error('Capture error:', error);
    // Could show a toast or update UI
  }, []);

  const handleBack = useCallback(() => {
    // Stop any existing stream
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
    // For RTMP, the audio comes from the ingress, not local capture
    // We just need to start egress
    setIsGoingLive(true);
    const connected = await broadcast.connect();
    if (connected) {
      // Start egress for the RTMP stream
      const res = await fetch('/api/livekit/egress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: 'channel-radio' }),
      });
      const data = await res.json();
      if (!data.error) {
        // Update broadcast state manually since we didn't use goLive
        // This is a simplified approach - in production might want to refactor
      }
    }
    setIsGoingLive(false);
  }, [broadcast]);

  const handleEndBroadcast = useCallback(async () => {
    // Stop local audio stream
    if (audioStream) {
      audioStream.getTracks().forEach(t => t.stop());
      setAudioStream(null);
    }

    await broadcast.endBroadcast();
    broadcast.setInputMethod(null);
  }, [audioStream, broadcast]);

  // Loading state
  if (tokenLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-gray-400">Validating broadcast link...</p>
        </div>
      </div>
    );
  }

  // Invalid token
  if (tokenError || !slot) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-8">
        <div className="bg-gray-900 rounded-xl p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Invalid Broadcast Link</h1>
          <p className="text-gray-400">
            {tokenError || 'This broadcast link is invalid or has expired.'}
          </p>
          <p className="text-gray-500 text-sm mt-4">
            Please contact the station owner for a new link.
          </p>
        </div>
      </div>
    );
  }

  // Schedule info screen (early or late)
  if ((scheduleStatus === 'early' || scheduleStatus === 'late') && !dismissedWarning) {
    const isEarly = scheduleStatus === 'early';
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-8">
        <div className="bg-gray-900 rounded-xl p-8 max-w-md">
          {isEarly ? (
            // Info icon (blue) for early - informational, not alarming
            <div className="w-16 h-16 bg-blue-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          ) : (
            // Warning icon (yellow) for late - show has started
            <div className="w-16 h-16 bg-yellow-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          )}
          <h1 className="text-xl font-bold text-white mb-2 text-center">
            {isEarly ? "Your Show Time" : "Your Show Has Started"}
          </h1>
          <p className="text-gray-400 text-center mb-2">
            {message}
          </p>
          <div className="text-center mb-6">
            <p className="text-white font-medium">{slot.showName || slot.djName}</p>
            <p className="text-gray-500 text-sm">
              {new Date(slot.startTime).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · {new Date(slot.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – {new Date(slot.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
          <div className="space-y-3">
            <button
              onClick={() => setDismissedWarning(true)}
              className={`w-full ${isEarly ? 'bg-blue-600 hover:bg-blue-700' : 'bg-yellow-600 hover:bg-yellow-700'} text-white font-bold py-3 px-6 rounded-lg transition-colors`}
            >
              {isEarly ? "Set Up Audio" : "Continue to Setup"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Live state
  if (broadcast.isLive) {
    return (
      <div className="min-h-screen bg-black p-8">
        <div className="max-w-lg mx-auto">
          <LiveIndicator
            slot={slot}
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
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Go Live</h1>
          {slot && (
            <div className="mt-2">
              <p className="text-gray-400">
                {slot.showName ? (
                  <>
                    <span className="text-white font-medium">{slot.showName}</span>
                    <span> • {slot.djName}</span>
                  </>
                ) : (
                  <span className="text-white font-medium">{slot.djName}</span>
                )}
              </p>
              <p className="text-gray-500 text-sm">
                {new Date(slot.startTime).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · {new Date(slot.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – {new Date(slot.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </p>
            </div>
          )}
        </div>

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
            {slot && (
              <div className="bg-gray-800 rounded-lg p-4 text-center">
                <p className="text-gray-400 text-sm">Your show</p>
                <p className="text-white font-medium">{slot.showName || slot.djName}</p>
                <p className="text-gray-400 text-sm">
                  {new Date(slot.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - {new Date(slot.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
            )}

            <AudioLevelMeter stream={audioStream} />

            <div className="bg-gray-900 rounded-xl p-4">
              <p className="text-gray-400 text-sm mb-4">
                Check your audio levels above to make sure sound is coming through.
                You can test as long as you need &mdash; your broadcast won&apos;t start until you click GO LIVE.
              </p>

              {canGoLive ? (
                <button
                  onClick={handleGoLive}
                  disabled={isGoingLive}
                  className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg text-xl transition-colors"
                >
                  {isGoingLive ? 'Going live...' : 'GO LIVE'}
                </button>
              ) : (
                <p className="text-center text-gray-500 py-4 font-medium">
                  {goLiveMessage}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
