'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useBroadcastToken } from '@/hooks/useBroadcastToken';
import { useToken } from './SearchParamsProvider';
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
import { QueuedWaitingScreen } from '@/components/broadcast/QueuedWaitingScreen';

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
  const token = useToken();
  const { user } = useAuthContext();

  const { slot, error: tokenError, loading: tokenLoading, scheduleStatus, message } = useBroadcastToken(token);

  // DJ onboarding state - declared early so djInfo can use it
  // Start directly at profile step (non-blocking login is inline in DJProfileSetup)
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('profile');
  const [djUsername, setDjUsername] = useState<string>('');
  const [slotDjUserId, setSlotDjUserId] = useState<string | undefined>(); // The slot's linked DJ userId
  const [initialTipButtonLink, setInitialTipButtonLink] = useState<string | undefined>();

  // Multi-DJ show: track current DJ slot to detect DJ changes (use ref to avoid re-render loops)
  const currentDjSlotIdRef = useRef<string | null>(null);

  // Fetch DJ profile data from the slot's linked DJ (user or pending)
  // This pre-populates tip button link and thank you message
  useEffect(() => {
    if (!token || !slot) return;
    // Don't fetch if multi-DJ slot detection will handle it
    if (slot.djSlots && slot.djSlots.length > 0) return;

    const fetchDjProfile = async () => {
      try {
        const res = await fetch(`/api/broadcast/slot-dj-profile?token=${encodeURIComponent(token)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.djUserId && !slotDjUserId) setSlotDjUserId(data.djUserId);
        if (data.chatUsername && !djUsername) setDjUsername(data.chatUsername);
        if (data.tipButtonLink && !initialTipButtonLink) setInitialTipButtonLink(data.tipButtonLink);
      } catch (err) {
        console.error('Failed to fetch slot DJ profile:', err);
      }
    };

    fetchDjProfile();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Only fetch once when slot loads
  }, [token, slot?.id]);

  // Get current DJ slot based on current time (for multi-DJ shows)
  const getCurrentDjSlot = useCallback(() => {
    if (!slot?.djSlots || slot.djSlots.length === 0) return null;
    const now = Date.now();
    return slot.djSlots.find(dj => now >= dj.startTime && now < dj.endTime) || null;
  }, [slot?.djSlots]);

  // Track if broadcast is live (set after broadcast hook is initialized)
  const [isLiveForDjSwitch, setIsLiveForDjSwitch] = useState(false);

  // Get the default DJ name for current slot
  // Priority: active DJ slot name > fetched chatUsername > slot djName
  const getDefaultDjName = useCallback(() => {
    const activeDjSlot = getCurrentDjSlot();
    if (activeDjSlot?.djName) return activeDjSlot.djName;
    if (djUsername) return djUsername;
    return slot?.djName;
  }, [getCurrentDjSlot, djUsername, slot?.djName]);

  // The DJ userId for the broadcast — use the slot's linked DJ, fall back to logged-in user
  const broadcastDjUserId = slotDjUserId || user?.uid;

  // Create DJ info object for useBroadcast
  const djInfo = useMemo(() => {
    if (!djUsername) return undefined;
    return {
      username: djUsername,
      userId: broadcastDjUserId,
    };
  }, [djUsername, broadcastDjUserId]);

  const participantIdentity = slot?.djName || 'DJ';
  const broadcast = useBroadcast(participantIdentity, slot?.id, djInfo, token || undefined);

  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [audioSourceLabel, setAudioSourceLabel] = useState<string | null>(null);
  const [dismissedWarning, setDismissedWarning] = useState(false);
  const [isGoingLive, setIsGoingLive] = useState(false);
  const [goingLiveCountdown, setGoingLiveCountdown] = useState(15);
  const [canGoLive, setCanGoLive] = useState(false);
  const [goLiveMessage, setGoLiveMessage] = useState('');
  const [slotEnded, setSlotEnded] = useState(false);
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomBusyUntil, setRoomBusyUntil] = useState<number | null>(null);

  // Proactively check if room is occupied before DJ clicks Go Live
  useEffect(() => {
    if (!slot || broadcast.isLive || slotEnded) return;

    const checkRoom = async () => {
      try {
        const status = await broadcast.checkRoomStatus();
        setRoomBusy(status.isLive);
        setRoomBusyUntil(status.currentSlotEndTime || null);
      } catch {
        // Network error — keep previous state
      }
    };

    checkRoom();
    const interval = setInterval(checkRoom, 5000);
    return () => clearInterval(interval);
  }, [slot, broadcast.isLive, broadcast.checkRoomStatus, slotEnded]);

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
          setInitialTipButtonLink(activeDjSlot.djTipButtonLink);

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
        }

        currentDjSlotIdRef.current = newSlotId;
      }
    };

    checkDjSlotChange();
    const interval = setInterval(checkDjSlotChange, 1000);
    return () => clearInterval(interval);
  }, [slot?.djSlots, slot?.id, slot?.broadcastType, getCurrentDjSlot, isLiveForDjSwitch]);

  // Countdown timer for "going live" screen
  useEffect(() => {
    if (!isGoingLive) {
      setGoingLiveCountdown(15);
      return;
    }
    const interval = setInterval(() => {
      setGoingLiveCountdown(prev => Math.max(prev - 1, 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [isGoingLive]);

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
  // Skip if the broadcast is currently live (we're actively broadcasting - don't auto-complete)
  useEffect(() => {
    if (!slot) return;
    if (broadcast.isLive) return;

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
  }, [slot, broadcast.isLive]);

  // Auto-retry when room is occupied by previous DJ
  useEffect(() => {
    if (!broadcast.roomOccupied) return;

    const poll = setInterval(async () => {
      try {
        const status = await broadcast.checkRoomStatus();
        if (!status.isLive) {
          console.log('Room is now free, clearing occupied state');
          broadcast.clearError();
        }
      } catch (err) {
        console.error('Failed to check room status:', err);
      }
    }, 5000);

    return () => clearInterval(poll);
  }, [broadcast.roomOccupied, broadcast.checkRoomStatus, broadcast.clearError]);

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

    console.log('[handleGoLive] Starting go-live flow');
    setIsGoingLive(true);
    try {
      console.log('[handleGoLive] Calling broadcast.goLive...');
      const success = await broadcast.goLive(audioStream);
      console.log('[handleGoLive] broadcast.goLive returned:', success);

      if (!success) {
        console.error('Failed to go live:', broadcast.error);
      }
    } finally {
      setIsGoingLive(false);
    }
  }, [audioStream, broadcast]);

  const handleQueueGoLive = useCallback(async () => {
    if (!audioStream) return;
    console.log('[handleQueueGoLive] Queueing to go live');
    await broadcast.queueGoLive(audioStream);
  }, [audioStream, broadcast]);

  const handleCancelQueue = useCallback(() => {
    broadcast.cancelQueue();
  }, [broadcast]);

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

  const handleEndBroadcast = useCallback(async (options?: { keepHlsEgress?: boolean }) => {
    // Stop local audio stream
    if (audioStream) {
      audioStream.getTracks().forEach(t => t.stop());
      setAudioStream(null);
    }

    await broadcast.endBroadcast(options);
    broadcast.setInputMethod(null);
  }, [audioStream, broadcast]);

  // Auto-end broadcast when slot time expires (while live)
  // keepHlsEgress: true so the HLS stream stays alive for seamless DJ transition
  useEffect(() => {
    if (!broadcast.isLive || !slot) return;

    const remainingMs = slot.endTime - Date.now();

    if (remainingMs <= 0) {
      // Slot already expired while live
      console.log('Slot time expired, ending broadcast (keeping HLS for transition)');
      setSlotEnded(true);
      handleEndBroadcast({ keepHlsEgress: true });
      return;
    }

    console.log(`Broadcast will auto-end in ${Math.round(remainingMs / 1000)}s`);

    const timer = setTimeout(() => {
      console.log('Slot time reached, auto-ending broadcast (keeping HLS for transition)');
      setSlotEnded(true);
      handleEndBroadcast({ keepHlsEgress: true });
    }, remainingMs);

    return () => clearTimeout(timer);
  }, [broadcast.isLive, slot, handleEndBroadcast]);

  // Detect when audio track ends (e.g. user clicks browser's "stop sharing" button)
  useEffect(() => {
    if (!audioStream) return;

    const track = audioStream.getAudioTracks()[0];
    if (!track) return;

    const onTrackEnded = () => {
      console.log('Audio track ended (user stopped sharing or device disconnected)');
      if (broadcast.isLive) {
        // End the broadcast and update Firebase
        handleEndBroadcast();
      } else {
        // Not live yet - clear stream so UI returns to audio capture selector
        audioStream.getTracks().forEach(t => t.stop());
        setAudioStream(null);
        setAudioSourceLabel(null);
      }
    };

    track.addEventListener('ended', onTrackEnded);
    return () => track.removeEventListener('ended', onTrackEnded);
  }, [audioStream, broadcast.isLive, handleEndBroadcast]);

  // DJ onboarding handler
  const handleProfileComplete = useCallback((username: string) => {
    setDjUsername(username);
    setOnboardingStep('audio');
  }, []);

  // Debug: trace which render branch is taken (use string so values show in collapsed console)
  const renderBranch = tokenLoading ? 'LOADING' :
    (tokenError || !slot) ? 'ERROR/NO_SLOT' :
    (slot.status === 'paused' && !dismissedWarning) ? 'PAUSED_WARNING' :
    (slotEnded && !broadcast.isLive) ? 'SLOT_ENDED' :
    broadcast.isLive ? 'LIVE' :
    (isGoingLive && audioStream) ? 'GOING_LIVE' :
    ((scheduleStatus === 'early' || scheduleStatus === 'late') && !dismissedWarning && slot.status !== 'live') ? 'SCHEDULE_INFO' :
    onboardingStep === 'profile' ? 'PROFILE_SETUP' :
    audioStream ? 'PRE_LIVE' :
    'AUDIO_SETUP';
  console.log(`[render] branch=${renderBranch} isLive=${broadcast.isLive} isGoingLive=${isGoingLive} audio=${!!audioStream} slot=${!!slot} onboarding=${onboardingStep} connected=${broadcast.isConnected} publishing=${broadcast.isPublishing}`);

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
          <p className="text-gray-500 text-sm mt-4">
            Have any issue? Check the <a href="https://channel-app.com/streaming-guide" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">setup guide</a> or call Cap at 415 316 3109
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
          <p className="text-gray-500 text-sm text-center mt-4">
            Have any issue? Check the <a href="https://channel-app.com/streaming-guide" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">setup guide</a> or call Cap at 415 316 3109
          </p>
        </div>
      </div>
    );
  }

  // Slot ended - show completion message after auto-end
  if (slotEnded && !broadcast.isLive) {
    return (
      <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center p-8">
        <div className="bg-[#252525] rounded-xl p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-green-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Your Slot Has Ended</h1>
          <p className="text-gray-400">
            Your broadcast has been completed. Thanks for DJing!
          </p>
          {slot && (
            <p className="text-gray-500 text-sm mt-4">
              {slot.showName || slot.djName} · {new Date(slot.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – {new Date(slot.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </p>
          )}
          <p className="text-gray-500 text-sm mt-4">
            Have any issue? Check the <a href="https://channel-app.com/streaming-guide" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">setup guide</a> or call Cap at 415 316 3109
          </p>
        </div>
      </div>
    );
  }

  // Live state - use DJControlCenter (checked before schedule status so a live broadcast is never hidden by the late/early modal)
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
          userId={broadcastDjUserId}
          tipButtonLink={initialTipButtonLink}
          onTipButtonLinkChange={setInitialTipButtonLink}
          isVenue={slot?.broadcastType === 'venue'}
          onChangeUsername={slot?.broadcastType === 'venue' ? setDjUsername : undefined}
          audioSourceLabel={audioSourceLabel}
        />

        {/* New DJ profile overlay for multi-DJ shows */}
        {needsNewDjProfile && (() => {
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
                  showName={slot?.showName}
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

  // Going live transition - show full-screen loading overlay while async goLive runs
  // This prevents the render tree from falling through to schedule/profile pages
  if (isGoingLive && audioStream) {
    const isRecording = slot?.broadcastType === 'recording';
    return (
      <div className="min-h-screen flex items-center justify-center" style={{
        animation: isRecording ? 'none' : 'pulse-bg 1s ease-in-out infinite',
        backgroundColor: '#1a1a1a',
      }}>
        <style>{`
          @keyframes pulse-bg {
            0%, 100% { background-color: #1a1a1a; }
            50% { background-color: #2a1a1a; }
          }
        `}</style>
        <div className="text-center">
          <h1 className={`text-3xl font-bold text-white mb-6 ${isRecording ? '' : 'animate-pulse'}`}>
            {isRecording ? 'Preparing to record' : goingLiveCountdown > 0
              ? `GOING LIVE IN LESS THAN ${goingLiveCountdown} SECOND${goingLiveCountdown > 1 ? 'S' : ''}`
              : 'Connecting...'}
          </h1>
          <div className={`w-12 h-12 border-4 ${isRecording ? 'border-white' : 'border-red-500'} border-t-transparent rounded-full animate-spin mx-auto`}></div>
          <p className="text-gray-500 text-sm mt-8">
            Have any issue? Check the <a href="https://channel-app.com/streaming-guide" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">setup guide</a> or call Cap at 415 316 3109
          </p>
        </div>
      </div>
    );
  }

  // Schedule info screen (early or late) - skip if slot is already live in Firestore
  if ((scheduleStatus === 'early' || scheduleStatus === 'late') && !dismissedWarning && slot.status !== 'live') {
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
          <p className="text-gray-500 text-sm text-center mt-4">
            Have any issue? Check the <a href="https://channel-app.com/streaming-guide" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">setup guide</a> or call Cap at 415 316 3109
          </p>
        </div>
      </div>
    );
  }

  // DJ Onboarding - Profile setup (with non-blocking inline login prompt)
  // All broadcasts show the profile step so DJs can confirm their info and accept terms
  if (onboardingStep === 'profile') {
    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <BroadcastHeader />
        <div className="flex items-center justify-center p-8 min-h-[calc(100vh-60px)]">
        <DJProfileSetup
          defaultUsername={getDefaultDjName()}
          showName={slot?.showName}
          broadcastType={slot?.broadcastType}
          onComplete={handleProfileComplete}
        />
        </div>
      </div>
    );
  }

  // Audio captured - show DJControlCenter in pre-live state (full screen)
  // When queued or going live, overlay the messaging on top of the existing DJControlCenter
  // so the LiveControlBar with audio levels stays visible
  if (audioStream) {
    const showQueueOverlay = broadcast.isQueued || broadcast.isGoingLive;
    return (
      <>
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
          userId={broadcastDjUserId}
          tipButtonLink={initialTipButtonLink}
          onTipButtonLinkChange={setInitialTipButtonLink}
          isVenue={slot?.broadcastType === 'venue'}
          onChangeUsername={slot?.broadcastType === 'venue' ? setDjUsername : undefined}
          onChangeAudioSetup={handleBack}
          onChangeSource={handleChangeSource}
          audioSourceLabel={audioSourceLabel}
          roomOccupied={roomBusy || broadcast.roomOccupied}
          roomFreeAt={roomBusyUntil || broadcast.roomFreeAt}
          onQueueGoLive={handleQueueGoLive}
        />
        {showQueueOverlay && (
          <QueuedWaitingScreen
            audioStream={audioStream}
            isGoingLive={broadcast.isGoingLive || false}
            isQueued={broadcast.isQueued || false}
            onCancel={handleCancelQueue}
            slotStartTime={slot?.startTime}
          />
        )}
      </>
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

        {/* Room occupied - waiting for previous DJ to finish */}
        {broadcast.roomOccupied && (
          <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-4 mb-6">
            <p className="text-yellow-400 font-medium">The previous broadcast is ending...</p>
            <p className="text-yellow-300/80 text-sm mt-1">
              {broadcast.roomFreeAt
                ? `Expected to finish at ${new Date(broadcast.roomFreeAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                : 'Please wait, this usually resolves within a few minutes.'}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-400"></div>
              <span className="text-yellow-300/60 text-sm">Checking automatically...</span>
            </div>
          </div>
        )}

        {/* Error display (non-room-occupied errors) */}
        {broadcast.error && !broadcast.roomOccupied && (
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

        <p className="text-gray-500 text-sm text-center mt-8">
          Have any issue? Check the <a href="https://channel-app.com/streaming-guide" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">setup guide</a> or call Cap at 415 316 3109
        </p>
      </div>
      </div>
    </div>
  );
}
