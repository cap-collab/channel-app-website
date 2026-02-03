'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useBroadcast } from '@/hooks/useBroadcast';
import { AudioInputSelector } from '@/components/broadcast/AudioInputSelector';
import { SystemAudioCapture } from '@/components/broadcast/SystemAudioCapture';
import { DeviceAudioCapture } from '@/components/broadcast/DeviceAudioCapture';
import { DJProfileSetup } from '@/components/broadcast/DJProfileSetup';
import { DJControlCenter } from '@/components/broadcast/DJControlCenter';
import { QuotaDisplay } from '@/components/recording/QuotaDisplay';
import { useAuthContext } from '@/contexts/AuthContext';
import { AuthModal } from '@/components/AuthModal';
import { AudioInputMethod } from '@/types/broadcast';
import { BroadcastHeader } from '@/components/BroadcastHeader';
import { useUserProfile } from '@/hooks/useUserProfile';

type SetupStep = 'quota' | 'profile' | 'audio';

interface RecordingQuota {
  monthKey: string;
  usedSeconds: number;
  maxSeconds: number;
  remainingSeconds: number;
  canRecord: boolean;
}

interface RecordingSession {
  slotId: string;
  broadcastToken: string;
  roomName: string;
}

export function RecordClient() {
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { chatUsername, djProfile } = useUserProfile(user?.uid);

  // Setup flow state
  const [setupStep, setSetupStep] = useState<SetupStep>('quota');
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Recording session state
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [quota, setQuota] = useState<RecordingQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  // Audio state
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [audioSourceLabel, setAudioSourceLabel] = useState<string | null>(null);
  const [isGoingLive, setIsGoingLive] = useState(false);

  // DJ profile state
  const [djUsername, setDjUsername] = useState<string>('');
  const [showName, setShowName] = useState<string>('');
  const [broadcastType, setBroadcastType] = useState<'remote' | 'venue'>('remote');
  const [initialPromoText, setInitialPromoText] = useState<string | undefined>();
  const [initialPromoHyperlink, setInitialPromoHyperlink] = useState<string | undefined>();
  const [initialThankYouMessage, setInitialThankYouMessage] = useState<string | undefined>();

  // DJ Info for broadcast hook
  const djInfo = useMemo(() => {
    if (!djUsername) return undefined;
    return {
      username: djUsername,
      userId: user?.uid,
      thankYouMessage: initialThankYouMessage,
    };
  }, [djUsername, user?.uid, initialThankYouMessage]);

  // Initialize broadcast hook with recording-only mode
  const broadcast = useBroadcast(
    djUsername || 'DJ',
    session?.slotId,
    djInfo,
    session?.broadcastToken,
    {
      recordingOnly: true,
      customRoomName: session?.roomName,
    }
  );

  // Fetch quota when user is authenticated
  useEffect(() => {
    async function fetchQuota() {
      if (!user?.uid) {
        setQuotaLoading(false);
        return;
      }

      try {
        setQuotaLoading(true);
        setQuotaError(null);
        const res = await fetch(`/api/recording/start?userId=${user.uid}`);
        const data = await res.json();

        if (data.error) {
          setQuotaError(data.error);
        } else {
          setQuota(data.quota);
        }
      } catch (error) {
        console.error('Failed to fetch quota:', error);
        setQuotaError('Failed to load recording quota');
      } finally {
        setQuotaLoading(false);
      }
    }

    fetchQuota();
  }, [user?.uid]);

  // Pre-fill username and promo from profile
  useEffect(() => {
    if (chatUsername) {
      setDjUsername(chatUsername);
    }
  }, [chatUsername]);

  useEffect(() => {
    if (djProfile?.thankYouMessage && !initialThankYouMessage) {
      setInitialThankYouMessage(djProfile.thankYouMessage);
    }
  }, [djProfile?.thankYouMessage, initialThankYouMessage]);

  // Handle continue from quota screen
  const handleQuotaContinue = useCallback(() => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    setSetupStep('profile');
  }, [isAuthenticated]);

  // Handle profile setup complete - same pattern as BroadcastClient
  const handleProfileComplete = useCallback((username: string, promoText?: string, promoHyperlink?: string, thankYouMessage?: string) => {
    setDjUsername(username);
    setInitialPromoText(promoText);
    setInitialPromoHyperlink(promoHyperlink);
    setInitialThankYouMessage(thankYouMessage);
    setSetupStep('audio');
  }, []);

  // Handle audio input selection
  const handleInputSelect = useCallback((method: AudioInputMethod) => {
    broadcast.setInputMethod(method);
  }, [broadcast]);

  // Handle audio stream capture
  const handleStream = useCallback((stream: MediaStream) => {
    setAudioStream(stream);
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
      setAudioSourceLabel(audioTracks[0].label || null);
    }
  }, []);

  // Handle capture error
  const handleError = useCallback((error: string) => {
    console.error('Capture error:', error);
  }, []);

  // Handle back from audio capture
  const handleBack = useCallback(() => {
    if (audioStream) {
      audioStream.getTracks().forEach(t => t.stop());
      setAudioStream(null);
      setAudioSourceLabel(null);
    }
    broadcast.setInputMethod(null);
  }, [audioStream, broadcast]);

  // Change source without changing input method
  const handleChangeSource = useCallback(() => {
    if (audioStream) {
      audioStream.getTracks().forEach(t => t.stop());
      setAudioStream(null);
      setAudioSourceLabel(null);
    }
  }, [audioStream]);

  // Start recording - creates session and goes live
  const handleStartRecording = useCallback(async () => {
    if (!audioStream || !user?.uid || !showName.trim()) return;

    setIsGoingLive(true);

    try {
      // Create recording session via API
      const res = await fetch('/api/recording/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          showName: showName.trim(),
          broadcastType,
        }),
      });

      const data = await res.json();

      if (data.error) {
        console.error('Failed to start recording session:', data.error);
        setIsGoingLive(false);
        return;
      }

      // Store session info - this will trigger the useEffect to go live
      setSession({
        slotId: data.slotId,
        broadcastToken: data.broadcastToken,
        roomName: data.roomName,
      });

      // Update quota
      if (data.quota) {
        setQuota(data.quota);
      }

    } catch (error) {
      console.error('Failed to start recording:', error);
      setIsGoingLive(false);
    }
  }, [audioStream, user?.uid, showName, broadcastType]);

  // Go live after session is created
  useEffect(() => {
    if (session && audioStream && !broadcast.isLive && isGoingLive) {
      broadcast.goLive(audioStream).then((success) => {
        setIsGoingLive(false);
        if (!success) {
          console.error('Failed to start recording');
        }
      });
    }
  }, [session, audioStream, broadcast, isGoingLive]);

  // Handle end recording
  const handleEndRecording = useCallback(async () => {
    if (audioStream) {
      audioStream.getTracks().forEach(t => t.stop());
      setAudioStream(null);
    }

    await broadcast.endBroadcast();
    broadcast.setInputMethod(null);
    setSession(null);

    // Refresh quota after recording ends
    if (user?.uid) {
      try {
        const res = await fetch(`/api/recording/start?userId=${user.uid}`);
        const data = await res.json();
        if (data.quota) {
          setQuota(data.quota);
        }
      } catch {
        // Ignore quota refresh errors
      }
    }
  }, [audioStream, broadcast, user?.uid]);

  // Auth loading state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  // Recording in progress or pre-recording with audio - show DJControlCenter
  if (session && audioStream) {
    return (
      <DJControlCenter
        slot={{
          id: session.slotId,
          showName: showName,
          djName: djUsername,
          startTime: Date.now(),
          endTime: Date.now() + 3 * 60 * 60 * 1000,
          status: broadcast.isLive ? 'live' : 'scheduled',
          stationId: 'channel-main',
          broadcastToken: session.broadcastToken,
          broadcastType: 'recording',
          createdAt: Date.now(),
          createdBy: user?.uid || '',
          tokenExpiresAt: Date.now() + 4 * 60 * 60 * 1000,
        }}
        audioStream={audioStream}
        inputMethod={broadcast.inputMethod}
        isLive={broadcast.isLive}
        isPublishing={broadcast.isPublishing}
        canGoLive={true}
        onGoLive={() => {}}
        isGoingLive={isGoingLive}
        onEndBroadcast={handleEndRecording}
        broadcastToken={session.broadcastToken}
        djUsername={djUsername}
        userId={user?.uid}
        tipTotalCents={0}
        tipCount={0}
        promoText={initialPromoText}
        promoHyperlink={initialPromoHyperlink}
        thankYouMessage={initialThankYouMessage}
        onPromoChange={(text, hyperlink) => {
          setInitialPromoText(text);
          setInitialPromoHyperlink(hyperlink);
        }}
        onThankYouChange={setInitialThankYouMessage}
        onChangeSource={handleChangeSource}
        audioSourceLabel={audioSourceLabel}
        isRecordingMode={true}
      />
    );
  }

  // Audio captured but no session yet - show DJControlCenter in pre-recording state
  if (audioStream && setupStep === 'audio') {
    return (
      <DJControlCenter
        slot={{
          id: 'pending',
          showName: showName,
          djName: djUsername,
          startTime: Date.now(),
          endTime: Date.now() + 3 * 60 * 60 * 1000,
          status: 'scheduled',
          stationId: 'channel-main',
          broadcastToken: '',
          broadcastType: 'recording',
          createdAt: Date.now(),
          createdBy: user?.uid || '',
          tokenExpiresAt: Date.now() + 4 * 60 * 60 * 1000,
        }}
        audioStream={audioStream}
        inputMethod={broadcast.inputMethod}
        isLive={false}
        isPublishing={false}
        canGoLive={true}
        onGoLive={handleStartRecording}
        isGoingLive={isGoingLive}
        onEndBroadcast={handleBack}
        broadcastToken=""
        djUsername={djUsername}
        userId={user?.uid}
        tipTotalCents={0}
        tipCount={0}
        promoText={initialPromoText}
        promoHyperlink={initialPromoHyperlink}
        thankYouMessage={initialThankYouMessage}
        onPromoChange={(text, hyperlink) => {
          setInitialPromoText(text);
          setInitialPromoHyperlink(hyperlink);
        }}
        onThankYouChange={setInitialThankYouMessage}
        onChangeAudioSetup={handleBack}
        onChangeSource={handleChangeSource}
        audioSourceLabel={audioSourceLabel}
        isRecordingMode={true}
      />
    );
  }

  // Quota screen (first step)
  if (setupStep === 'quota') {
    return (
      <>
        <BroadcastHeader stationName="Record Your Set" />
        <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center p-8">
          <div className="bg-[#252525] rounded-xl p-8 max-w-md w-full">
            <h1 className="text-2xl font-bold text-white mb-2">Record Your Set</h1>
            <p className="text-gray-400 mb-6">
              Record up to 2 hours per month. Your recording will appear on your profile after you publish it.
            </p>

            {quotaLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              </div>
            ) : quotaError ? (
              <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6">
                {quotaError}
              </div>
            ) : quota ? (
              <QuotaDisplay quota={quota} />
            ) : !isAuthenticated ? (
              <div className="bg-gray-800 rounded-lg p-4 mb-6">
                <p className="text-gray-300 text-sm">
                  Sign in to see your recording quota and start recording.
                </p>
              </div>
            ) : null}

            {!isAuthenticated ? (
              <button
                onClick={() => setShowAuthModal(true)}
                className="w-full bg-accent hover:bg-accent-hover text-white font-bold py-4 px-6 rounded-lg transition-colors"
              >
                Sign In to Record
              </button>
            ) : quota?.canRecord ? (
              <button
                onClick={handleQuotaContinue}
                className="w-full bg-accent hover:bg-accent-hover text-white font-bold py-4 px-6 rounded-lg transition-colors"
              >
                Continue
              </button>
            ) : (
              <button
                disabled
                className="w-full bg-gray-700 text-gray-400 font-bold py-4 px-6 rounded-lg cursor-not-allowed"
              >
                No Quota Remaining This Month
              </button>
            )}
          </div>
        </div>

        {showAuthModal && (
          <AuthModal
            isOpen={showAuthModal}
            onClose={() => setShowAuthModal(false)}
            includeDjTerms={true}
          />
        )}
      </>
    );
  }

  // Profile setup step - use DJProfileSetup like BroadcastClient
  if (setupStep === 'profile') {
    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <BroadcastHeader stationName="Record Your Set" />
        <div className="flex items-center justify-center p-8 min-h-[calc(100vh-60px)]">
          <div className="max-w-md w-full">
            {/* Show name input */}
            <div className="bg-[#252525] rounded-xl p-8 mb-4">
              <label htmlFor="showName" className="block text-gray-400 text-sm mb-2">
                Recording Name <span className="text-red-400">*</span>
              </label>
              <input
                id="showName"
                type="text"
                value={showName}
                onChange={(e) => setShowName(e.target.value)}
                placeholder="My DJ Set"
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-gray-500 mb-4"
                maxLength={100}
                required
              />

              {/* Recording context */}
              <label className="block text-gray-400 text-sm mb-2">
                Where are you recording from?
              </label>
              <div className="flex gap-3 mb-4">
                <button
                  type="button"
                  onClick={() => setBroadcastType('remote')}
                  className={`flex-1 py-3 px-4 rounded-lg border transition-colors ${
                    broadcastType === 'remote'
                      ? 'bg-accent border-accent text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                  }`}
                >
                  From Home
                </button>
                <button
                  type="button"
                  onClick={() => setBroadcastType('venue')}
                  className={`flex-1 py-3 px-4 rounded-lg border transition-colors ${
                    broadcastType === 'venue'
                      ? 'bg-accent border-accent text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                  }`}
                >
                  From a Venue
                </button>
              </div>
            </div>

            {/* DJ Profile setup (reused component) */}
            <DJProfileSetup
              defaultUsername={chatUsername || ''}
              defaultPromoText={djProfile?.promoText || undefined}
              defaultPromoHyperlink={djProfile?.promoHyperlink || undefined}
              defaultThankYouMessage={djProfile?.thankYouMessage || undefined}
              broadcastType={broadcastType}
              onComplete={(username, promoText, promoHyperlink, thankYouMessage) => {
                if (showName.trim()) {
                  handleProfileComplete(username, promoText, promoHyperlink, thankYouMessage);
                }
              }}
            />

            {!showName.trim() && (
              <p className="text-red-400 text-sm text-center mt-4">
                Please enter a recording name above
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Audio setup step - similar to BroadcastClient's audio selection screen
  if (setupStep === 'audio') {
    return (
      <div className="min-h-screen bg-[#1a1a1a] text-white">
        <BroadcastHeader stationName="Record Your Set" />
        <div className="p-8">
          <div className="max-w-lg mx-auto">
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-bold">Recording Setup</h1>
              <div className="mt-2">
                <p className="text-white font-medium">{showName}</p>
                <p className="text-gray-400">Recording as {djUsername}</p>
                {quota && (
                  <p className="text-gray-500 text-sm mt-1">
                    {Math.floor(quota.remainingSeconds / 60)} minutes remaining this month
                  </p>
                )}
              </div>
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
          </div>
        </div>
      </div>
    );
  }

  return null;
}
