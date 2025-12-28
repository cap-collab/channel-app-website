'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useBroadcastToken } from '@/hooks/useBroadcastToken';
import { useBroadcast } from '@/hooks/useBroadcast';
import { AudioInputSelector } from '@/components/broadcast/AudioInputSelector';
import { SystemAudioCapture } from '@/components/broadcast/SystemAudioCapture';
import { DeviceAudioCapture } from '@/components/broadcast/DeviceAudioCapture';
import { RtmpIngressPanel } from '@/components/broadcast/RtmpIngressPanel';
import { AudioLevelMeter } from '@/components/broadcast/AudioLevelMeter';
import { LiveIndicator } from '@/components/broadcast/LiveIndicator';
import { DJProfileSetup } from '@/components/broadcast/DJProfileSetup';
import { useAuthContext } from '@/contexts/AuthContext';
import { AudioInputMethod } from '@/types/broadcast';
import { BroadcastHeader } from '@/components/BroadcastHeader';

type OnboardingStep = 'profile' | 'audio';

// Channel app deep link for the broadcast station
const CHANNEL_BROADCAST_URL = 'https://channel-app.com/channel';

// Channel App URL Section Component
function ChannelAppUrlSection() {
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(CHANNEL_BROADCAST_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error('Failed to copy');
    }
  };

  return (
    <div className="bg-[#252525] rounded-xl p-4">
      <label className="block text-gray-400 text-sm mb-2">Listen in Channel</label>
      <div className="flex gap-2">
        <input
          type="text"
          readOnly
          value={CHANNEL_BROADCAST_URL}
          className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm"
        />
        <button
          onClick={copyUrl}
          className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-3 rounded-lg transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <p className="text-gray-500 text-xs mt-2">
        Share this link to open your broadcast in the Channel app
      </p>
    </div>
  );
}

export function BroadcastClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const { user } = useAuthContext();

  const { slot, error: tokenError, loading: tokenLoading, scheduleStatus, message } = useBroadcastToken(token);

  // DJ onboarding state - declared early so djInfo can use it
  // Start directly at profile step (non-blocking login is inline in DJProfileSetup)
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('profile');
  const [djUsername, setDjUsername] = useState<string>('');
  const [initialPromoUrl, setInitialPromoUrl] = useState<string | undefined>();
  const [initialPromoTitle, setInitialPromoTitle] = useState<string | undefined>();

  // Multi-DJ show: track current DJ slot to detect DJ changes
  const [currentDjSlotId, setCurrentDjSlotId] = useState<string | null>(null);

  // Get current DJ slot based on current time (for multi-DJ shows)
  const getCurrentDjSlot = useCallback(() => {
    if (!slot?.djSlots || slot.djSlots.length === 0) return null;
    const now = Date.now();
    return slot.djSlots.find(dj => now >= dj.startTime && now < dj.endTime) || null;
  }, [slot?.djSlots]);

  // Detect DJ slot changes and reset profile state for new DJ
  useEffect(() => {
    if (!slot?.djSlots || slot.djSlots.length === 0) return;

    const checkDjSlotChange = () => {
      const activeDjSlot = getCurrentDjSlot();
      const newSlotId = activeDjSlot?.id || null;

      // If DJ slot changed and we have a username set (meaning previous DJ completed profile)
      if (newSlotId !== currentDjSlotId && currentDjSlotId !== null && djUsername) {
        // New DJ slot started - reset profile for the new DJ
        setDjUsername('');
        setInitialPromoUrl(undefined);
        setInitialPromoTitle(undefined);
        setInitialPromoSubmitted(false);
        setOnboardingStep('profile');
        console.log('DJ slot changed, prompting new DJ for profile');
      }

      setCurrentDjSlotId(newSlotId);
    };

    checkDjSlotChange();
    const interval = setInterval(checkDjSlotChange, 1000);
    return () => clearInterval(interval);
  }, [slot?.djSlots, currentDjSlotId, djUsername, getCurrentDjSlot]);

  // Get the default DJ name for current slot (either from djSlot or single djName)
  const getDefaultDjName = useCallback(() => {
    const activeDjSlot = getCurrentDjSlot();
    if (activeDjSlot?.djName) return activeDjSlot.djName;
    return slot?.djName;
  }, [getCurrentDjSlot, slot?.djName]);

  // Create DJ info object for useBroadcast
  const djInfo = useMemo(() => {
    if (!djUsername) return undefined;
    return {
      username: djUsername,
      userId: user?.uid,
    };
  }, [djUsername, user?.uid]);

  const participantIdentity = slot?.djName || 'DJ';
  const broadcast = useBroadcast(participantIdentity, slot?.id, djInfo, token || undefined);

  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [dismissedWarning, setDismissedWarning] = useState(false);
  const [isGoingLive, setIsGoingLive] = useState(false);
  const [canGoLive, setCanGoLive] = useState(false);
  const [goLiveMessage, setGoLiveMessage] = useState('');
  const [autoGoLive, setAutoGoLive] = useState(false);
  const [autoGoLiveTriggered, setAutoGoLiveTriggered] = useState(false);
  const [initialPromoSubmitted, setInitialPromoSubmitted] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);


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

  // Auto-complete slot when end time passes
  useEffect(() => {
    if (!slot) return;

    const checkSlotCompletion = async () => {
      const now = Date.now();
      // If slot end time has passed and slot is still live/paused/scheduled, mark as completed
      if (now > slot.endTime && (slot.status === 'live' || slot.status === 'paused' || slot.status === 'scheduled')) {
        try {
          await fetch('/api/broadcast/complete-slot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slotId: slot.id }),
          });
          console.log('Slot auto-completed due to end time');
        } catch (err) {
          console.error('Failed to auto-complete slot:', err);
        }
      }
    };

    // Check immediately and then every 10 seconds
    checkSlotCompletion();
    const interval = setInterval(checkSlotCompletion, 10000);
    return () => clearInterval(interval);
  }, [slot]);

  // Update liveDjUserId on the broadcast slot when user logs in while already live
  // This enables the iOS app to recognize them as the DJ for chat
  useEffect(() => {
    if (!broadcast.isLive || !user?.uid || !token || !slot?.id) return;

    const updateDjUserId = async () => {
      try {
        const response = await fetch('/api/broadcast/update-dj-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            broadcastToken: token,
            djUserId: user.uid,
          }),
        });
        if (response.ok) {
          console.log('Updated liveDjUserId on slot after login');
        }
      } catch (err) {
        console.error('Failed to update DJ user ID:', err);
      }
    };

    updateDjUserId();
  }, [broadcast.isLive, user?.uid, token, slot?.id]);

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
    setPromoError(null);
    const success = await broadcast.goLive(audioStream);

    // If we have an initial promo from onboarding, submit it now
    if (success && initialPromoUrl && token) {
      try {
        const promoRes = await fetch('/api/broadcast/dj-promo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            broadcastToken: token,
            promoUrl: initialPromoUrl,
            promoTitle: initialPromoTitle,
            username: djUsername,
          }),
        });

        if (promoRes.ok) {
          setInitialPromoSubmitted(true);
        } else {
          const errorData = await promoRes.json();
          console.error('Failed to submit initial promo:', errorData.error);
          setPromoError(errorData.error || 'Failed to post promo link');
        }
      } catch (err) {
        console.error('Failed to submit initial promo:', err);
        setPromoError('Failed to post promo link');
      }
    }

    setIsGoingLive(false);

    if (!success) {
      console.error('Failed to go live:', broadcast.error);
    }
  }, [audioStream, broadcast, initialPromoUrl, initialPromoTitle, token, djUsername]);

  // Auto go-live: trigger when slot start time arrives and autoGoLive is enabled
  useEffect(() => {
    if (!slot || !autoGoLive || autoGoLiveTriggered || !audioStream || broadcast.isLive || isGoingLive) return;

    const checkAutoGoLive = () => {
      const now = Date.now();
      // Trigger exactly at slot start time (not 1 minute before)
      if (now >= slot.startTime && now <= slot.endTime) {
        setAutoGoLiveTriggered(true);
        handleGoLive();
      }
    };

    checkAutoGoLive();
    const interval = setInterval(checkAutoGoLive, 1000);
    return () => clearInterval(interval);
  }, [slot, autoGoLive, autoGoLiveTriggered, audioStream, broadcast.isLive, isGoingLive, handleGoLive]);

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

  // DJ onboarding handler
  const handleProfileComplete = useCallback((username: string, promoUrl?: string, promoTitle?: string) => {
    setDjUsername(username);
    setInitialPromoUrl(promoUrl);
    setInitialPromoTitle(promoTitle);
    setOnboardingStep('audio');
  }, []);

  // Loading state
  if (tokenLoading) {
    return (
      <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center">
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
      <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center p-8">
        <div className="bg-[#252525] rounded-xl p-8 max-w-md text-center">
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

  // Paused state - DJ disconnected, can resume
  if (slot.status === 'paused' && !dismissedWarning) {
    return (
      <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center p-8">
        <div className="bg-[#252525] rounded-xl p-8 max-w-md">
          <div className="w-16 h-16 bg-orange-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2 text-center">
            Broadcast Paused
          </h1>
          <p className="text-gray-400 text-center mb-2">
            Your broadcast was interrupted. You can resume where you left off.
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
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-6 rounded-lg transition-colors"
            >
              Resume Broadcast
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Schedule info screen (early or late)
  if ((scheduleStatus === 'early' || scheduleStatus === 'late') && !dismissedWarning) {
    const isEarly = scheduleStatus === 'early';
    return (
      <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center p-8">
        <div className="bg-[#252525] rounded-xl p-8 max-w-md">
          {isEarly ? (
            // Info icon (blue) for early - informational, not alarming
            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              className={`w-full ${isEarly ? 'bg-accent hover:bg-accent-hover' : 'bg-yellow-600 hover:bg-yellow-700'} text-white font-bold py-3 px-6 rounded-lg transition-colors`}
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
    // If djUsername is empty (new DJ slot started), show profile overlay
    const needsNewDjProfile = !djUsername && slot?.djSlots && slot.djSlots.length > 0;

    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <BroadcastHeader />
        <div className="p-4 lg:p-8">
          <div className="max-w-6xl mx-auto">
            {/* Show promo error if initial promo failed */}
            {promoError && (
              <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 mb-4">
                <p className="text-red-400">Promo link failed: {promoError}</p>
                <button
                  onClick={() => setPromoError(null)}
                  className="text-red-300 text-sm underline mt-2"
                >
                  Dismiss
                </button>
              </div>
            )}
            <LiveIndicator
              slot={slot}
              hlsUrl={broadcast.hlsUrl}
              onEndBroadcast={handleEndBroadcast}
              broadcastToken={token || undefined}
              djUsername={djUsername}
              initialPromoSubmitted={initialPromoSubmitted}
              isVenue={slot?.broadcastType === 'venue'}
              onChangeUsername={slot?.broadcastType === 'venue' ? setDjUsername : undefined}
            />
          </div>

          {/* New DJ profile overlay for multi-DJ shows */}
          {needsNewDjProfile && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="relative">
                <div className="absolute -top-12 left-0 right-0 text-center">
                  <span className="inline-flex items-center gap-2 bg-red-600 text-white text-sm font-medium px-3 py-1 rounded-full">
                    <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                    Broadcast is live
                  </span>
                </div>
                <DJProfileSetup
                  defaultUsername={getDefaultDjName()}
                  broadcastType={slot?.broadcastType}
                  onComplete={handleProfileComplete}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // DJ Onboarding - Profile setup (with non-blocking inline login prompt)
  if (onboardingStep === 'profile') {
    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <BroadcastHeader />
        <div className="flex items-center justify-center p-8 min-h-[calc(100vh-60px)]">
        <DJProfileSetup
          defaultUsername={getDefaultDjName()}
          broadcastType={slot?.broadcastType}
          onComplete={handleProfileComplete}
        />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a1a] text-white">
      <BroadcastHeader />
      <div className="p-8">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Livestream Setup</h1>
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

<AudioLevelMeter stream={audioStream} />

            {/* Channel App URL */}
            <ChannelAppUrlSection />

            <div className="bg-[#252525] rounded-xl p-4">
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
                <div className="space-y-3">
                  <p className="text-center text-gray-500 font-medium">
                    {goLiveMessage}
                  </p>

                  {/* Auto go-live option */}
                  {slot && !autoGoLive ? (
                    <button
                      onClick={() => setAutoGoLive(true)}
                      className="w-full bg-accent hover:bg-accent-hover text-white font-bold py-3 px-6 rounded-lg transition-colors"
                    >
                      Go live automatically at {new Date(slot.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </button>
                  ) : slot && autoGoLive ? (
                    <div className="bg-accent/10 border border-accent/30 rounded-lg p-3 text-center">
                      <p className="text-accent font-medium flex items-center justify-center gap-2">
                        <svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Auto go-live enabled
                      </p>
                      <p className="text-accent/70 text-sm mt-1">
                        Will start at {new Date(slot.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </p>
                      <button
                        onClick={() => setAutoGoLive(false)}
                        className="text-accent text-sm underline mt-2"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
