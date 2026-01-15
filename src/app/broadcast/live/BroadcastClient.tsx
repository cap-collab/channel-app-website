'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useBroadcastToken } from '@/hooks/useBroadcastToken';
import { useBroadcast } from '@/hooks/useBroadcast';
import { AudioInputSelector } from '@/components/broadcast/AudioInputSelector';
import { SystemAudioCapture } from '@/components/broadcast/SystemAudioCapture';
import { DeviceAudioCapture } from '@/components/broadcast/DeviceAudioCapture';
import { RtmpIngressPanel } from '@/components/broadcast/RtmpIngressPanel';
import { DJProfileSetup } from '@/components/broadcast/DJProfileSetup';
import { DJControlCenter } from '@/components/broadcast/DJControlCenter';
import { useAuthContext } from '@/contexts/AuthContext';
import { AudioInputMethod } from '@/types/broadcast';
import { BroadcastHeader } from '@/components/BroadcastHeader';
import { useTipTotal } from '@/hooks/useTipTotal';
import { useUserProfile } from '@/hooks/useUserProfile';
import { normalizeUrl } from '@/lib/url';

type OnboardingStep = 'profile' | 'audio';

// Helper to format time, including the date if it's not today
function formatTimeWithDate(date: Date): string {
  const today = new Date();
  const isToday = date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (isToday) {
    return timeStr;
  }
  const dateStr = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dateStr} at ${timeStr}`;
}

export function BroadcastClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const { user } = useAuthContext();

  const { slot, error: tokenError, loading: tokenLoading, scheduleStatus, message } = useBroadcastToken(token);

  // Tips for current broadcast - query by slot ID only, regardless of who's logged in
  const { totalCents: tipTotalCents, tipCount } = useTipTotal({
    broadcastSlotId: slot?.id,
  });

  // User profile - to get saved thank you message for logged-in users
  const { djProfile } = useUserProfile(user?.uid);

  // DJ onboarding state - declared early so djInfo can use it
  // Start directly at profile step (non-blocking login is inline in DJProfileSetup)
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('profile');
  const [djUsername, setDjUsername] = useState<string>('');
  const [initialPromoText, setInitialPromoText] = useState<string | undefined>();
  const [initialPromoHyperlink, setInitialPromoHyperlink] = useState<string | undefined>();
  const [initialThankYouMessage, setInitialThankYouMessage] = useState<string | undefined>();

  // Multi-DJ show: track current DJ slot to detect DJ changes (use ref to avoid re-render loops)
  const currentDjSlotIdRef = useRef<string | null>(null);

  // Load saved thank you message from user profile when logged in
  useEffect(() => {
    if (djProfile?.thankYouMessage && !initialThankYouMessage) {
      setInitialThankYouMessage(djProfile.thankYouMessage);
    }
  }, [djProfile?.thankYouMessage, initialThankYouMessage]);

  // Get current DJ slot based on current time (for multi-DJ shows)
  const getCurrentDjSlot = useCallback(() => {
    if (!slot?.djSlots || slot.djSlots.length === 0) return null;
    const now = Date.now();
    return slot.djSlots.find(dj => now >= dj.startTime && now < dj.endTime) || null;
  }, [slot?.djSlots]);

  // Track if broadcast is live (set after broadcast hook is initialized)
  const [isLiveForDjSwitch, setIsLiveForDjSwitch] = useState(false);

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
      thankYouMessage: initialThankYouMessage,
    };
  }, [djUsername, user?.uid, initialThankYouMessage]);

  const participantIdentity = slot?.djName || 'DJ';
  const broadcast = useBroadcast(participantIdentity, slot?.id, djInfo, token || undefined);

  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [audioSourceLabel, setAudioSourceLabel] = useState<string | null>(null);
  const [dismissedWarning, setDismissedWarning] = useState(false);
  const [isGoingLive, setIsGoingLive] = useState(false);
  const [canGoLive, setCanGoLive] = useState(false);
  const [goLiveMessage, setGoLiveMessage] = useState('');
  const [initialPromoSubmitted, setInitialPromoSubmitted] = useState(false);

  // Sync isLiveForDjSwitch with broadcast.isLive
  useEffect(() => {
    setIsLiveForDjSwitch(broadcast.isLive);
  }, [broadcast.isLive]);

  // Detect DJ slot changes and auto-switch DJ info
  useEffect(() => {
    if (!slot?.djSlots || slot.djSlots.length === 0) return;

    const checkDjSlotChange = async () => {
      const activeDjSlot = getCurrentDjSlot();
      const newSlotId = activeDjSlot?.id || null;

      // If DJ slot changed
      if (newSlotId !== currentDjSlotIdRef.current) {
        if (activeDjSlot) {
          // Auto-load DJ info from the pre-configured slot data
          // Use djUsername (chat username from profile) if available, otherwise fall back to djName
          const username = activeDjSlot.djUsername || activeDjSlot.djName || '';
          setDjUsername(username);
          setInitialPromoText(activeDjSlot.djPromoText || activeDjSlot.promoText);
          setInitialPromoHyperlink(activeDjSlot.djPromoHyperlink || activeDjSlot.promoHyperlink);
          setInitialThankYouMessage(activeDjSlot.djThankYouMessage);
          setInitialPromoSubmitted(false);

          // If broadcast is live, call switch-dj API to update backend
          if (isLiveForDjSwitch && slot.id && newSlotId) {
            try {
              await fetch('/api/broadcast/switch-dj', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  slotId: slot.id,
                  djSlotId: newSlotId,
                }),
              });
              console.log('Switched to new DJ slot:', newSlotId, username);
            } catch (err) {
              console.error('Failed to switch DJ slot:', err);
            }
          }
        } else {
          // No active slot - clear info
          setDjUsername('');
          setInitialPromoText(undefined);
          setInitialPromoHyperlink(undefined);
          setInitialThankYouMessage(undefined);
        }

        currentDjSlotIdRef.current = newSlotId;
      }
    };

    checkDjSlotChange();
    const interval = setInterval(checkDjSlotChange, 1000);
    return () => clearInterval(interval);
  }, [slot?.djSlots, slot?.id, slot?.broadcastType, getCurrentDjSlot, isLiveForDjSwitch]);

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
        const availableTime = formatTimeWithDate(new Date(oneMinuteBefore));
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
    // Extract the audio source label from the stream
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
      setAudioSourceLabel(audioTracks[0].label || null);
    }
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
      setAudioSourceLabel(null);
    }
    broadcast.setInputMethod(null);
  }, [audioStream, broadcast]);

  // Change source without changing input method (re-capture from different tab/device)
  const handleChangeSource = useCallback(() => {
    // Stop any existing stream but keep the input method
    if (audioStream) {
      audioStream.getTracks().forEach(t => t.stop());
      setAudioStream(null);
      setAudioSourceLabel(null);
    }
    // This will show the capture UI again for the same input method
  }, [audioStream]);

  const handleGoLive = useCallback(async () => {
    if (!audioStream) return;

    setIsGoingLive(true);
    const success = await broadcast.goLive(audioStream);

    // If we have an initial promo from onboarding, submit it now
    if (success && initialPromoText && token) {
      try {
        const promoRes = await fetch('/api/broadcast/dj-promo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            broadcastToken: token,
            promoText: initialPromoText,
            promoHyperlink: initialPromoHyperlink ? normalizeUrl(initialPromoHyperlink) : undefined,
            username: djUsername,
          }),
        });

        if (promoRes.ok) {
          setInitialPromoSubmitted(true);
        } else {
          const errorData = await promoRes.json();
          console.error('Failed to submit initial promo:', errorData.error);
        }
      } catch (err) {
        console.error('Failed to submit initial promo:', err);
      }
    }

    setIsGoingLive(false);

    if (!success) {
      console.error('Failed to go live:', broadcast.error);
    }
  }, [audioStream, broadcast, initialPromoText, initialPromoHyperlink, token, djUsername]);

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
  const handleProfileComplete = useCallback((username: string, promoText?: string, promoHyperlink?: string, thankYouMessage?: string) => {
    setDjUsername(username);
    setInitialPromoText(promoText);
    setInitialPromoHyperlink(promoHyperlink);
    setInitialThankYouMessage(thankYouMessage);
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

  // Live state - use DJControlCenter
  if (broadcast.isLive) {
    // For venue broadcasts, DJ info is pre-configured - no profile overlay needed
    // Only show profile overlay for remote broadcasts if username is missing
    const needsNewDjProfile = !djUsername && slot?.broadcastType !== 'venue' && slot?.djSlots && slot.djSlots.length > 0;

    return (
      <>
        <DJControlCenter
          slot={slot}
          audioStream={audioStream}
          inputMethod={broadcast.inputMethod}
          isLive={true}
          isPublishing={broadcast.isPublishing}
          canGoLive={true}
          onGoLive={handleGoLive}
          isGoingLive={isGoingLive}
          onEndBroadcast={handleEndBroadcast}
          broadcastToken={token || ''}
          djUsername={djUsername}
          userId={user?.uid}
          tipTotalCents={tipTotalCents}
          tipCount={tipCount}
          promoText={initialPromoText}
          promoHyperlink={initialPromoHyperlink}
          thankYouMessage={initialThankYouMessage}
          onPromoChange={(text, hyperlink) => {
            setInitialPromoText(text);
            setInitialPromoHyperlink(hyperlink);
            setInitialPromoSubmitted(true);
          }}
          onThankYouChange={setInitialThankYouMessage}
          isVenue={slot?.broadcastType === 'venue'}
          onChangeUsername={slot?.broadcastType === 'venue' ? setDjUsername : undefined}
          initialPromoSubmitted={initialPromoSubmitted}
          audioSourceLabel={audioSourceLabel}
        />

        {/* New DJ profile overlay for multi-DJ shows */}
        {needsNewDjProfile && (() => {
          const activeDjSlot = getCurrentDjSlot();
          return (
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
                  defaultPromoText={activeDjSlot?.djPromoText || activeDjSlot?.promoText || slot?.showPromoText}
                  defaultPromoHyperlink={activeDjSlot?.djPromoHyperlink || activeDjSlot?.promoHyperlink || slot?.showPromoHyperlink}
                  defaultThankYouMessage={activeDjSlot?.djThankYouMessage}
                  broadcastType={slot?.broadcastType}
                  onComplete={handleProfileComplete}
                />
              </div>
            </div>
          );
        })()}
      </>
    );
  }

  // DJ Onboarding - Profile setup (with non-blocking inline login prompt)
  // All broadcasts show the profile step so DJs can confirm their info and accept terms
  if (onboardingStep === 'profile') {
    // Get active DJ slot for pre-filling profile data
    const activeDjSlot = getCurrentDjSlot();
    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <BroadcastHeader />
        <div className="flex items-center justify-center p-8 min-h-[calc(100vh-60px)]">
        <DJProfileSetup
          defaultUsername={getDefaultDjName()}
          defaultPromoText={activeDjSlot?.djPromoText || activeDjSlot?.promoText || slot?.showPromoText}
          defaultPromoHyperlink={activeDjSlot?.djPromoHyperlink || activeDjSlot?.promoHyperlink || slot?.showPromoHyperlink}
          defaultThankYouMessage={activeDjSlot?.djThankYouMessage}
          broadcastType={slot?.broadcastType}
          onComplete={handleProfileComplete}
        />
        </div>
      </div>
    );
  }

  // Audio captured - show DJControlCenter in pre-live state (full screen)
  if (audioStream) {
    return (
      <DJControlCenter
        slot={slot}
        audioStream={audioStream}
        inputMethod={broadcast.inputMethod}
        isLive={false}
        isPublishing={false}
        canGoLive={canGoLive}
        goLiveMessage={goLiveMessage}
        onGoLive={handleGoLive}
        isGoingLive={isGoingLive}
        onEndBroadcast={handleEndBroadcast}
        broadcastToken={token || ''}
        djUsername={djUsername}
        userId={user?.uid}
        tipTotalCents={tipTotalCents}
        tipCount={tipCount}
        promoText={initialPromoText}
        promoHyperlink={initialPromoHyperlink}
        thankYouMessage={initialThankYouMessage}
        onPromoChange={(text, hyperlink) => {
          setInitialPromoText(text);
          setInitialPromoHyperlink(hyperlink);
        }}
        onThankYouChange={setInitialThankYouMessage}
        isVenue={slot?.broadcastType === 'venue'}
        onChangeUsername={slot?.broadcastType === 'venue' ? setDjUsername : undefined}
        initialPromoSubmitted={initialPromoSubmitted}
        onChangeAudioSetup={handleBack}
        onChangeSource={handleChangeSource}
        audioSourceLabel={audioSourceLabel}
      />
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

      </div>
      </div>
    </div>
  );
}
