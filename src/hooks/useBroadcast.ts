'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Room, RoomEvent, Track, LocalTrack, DisconnectReason, TrackEvent } from 'livekit-client';
import { BroadcastState, ROOM_NAME, RoomStatus } from '@/types/broadcast';

const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';

async function fetchWithTimeout(input: RequestInfo, init: RequestInit & { timeoutMs: number }) {
  const { timeoutMs, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface DJInfo {
  username: string;
  userId?: string;
  thankYouMessage?: string;
}

interface BroadcastOptions {
  recordingOnly?: boolean;  // Skip HLS, only record
  customRoomName?: string;  // Use custom room name instead of shared channel-radio
}

export function useBroadcast(
  participantIdentity: string,
  slotId?: string,
  djInfo?: DJInfo,
  broadcastToken?: string,
  options?: BroadcastOptions,
  slotEndTime?: number,
) {
  // Determine the room name to use
  const roomName = options?.customRoomName || ROOM_NAME;
  const recordingOnly = options?.recordingOnly || false;

  const [state, setState] = useState<BroadcastState>({
    inputMethod: null,
    isConnected: false,
    isPublishing: false,
    isLive: false,
    egressId: null,
    recordingEgressId: null,
    hlsUrl: null,
    roomName,
    error: null,
    roomOccupied: false,
    roomFreeAt: null,
    isQueued: false,
    isGoingLive: false,
  });

  const roomRef = useRef<Room | null>(null);
  const audioTrackRef = useRef<LocalTrack | null>(null);
  const queuePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Use refs to ensure callbacks always have latest values
  // Initialize refs AND update them synchronously on each render
  // (useEffect runs after render, which is too late for callbacks)
  const broadcastTokenRef = useRef(broadcastToken);
  broadcastTokenRef.current = broadcastToken;

  const djInfoRef = useRef(djInfo);
  djInfoRef.current = djInfo;

  const slotIdRef = useRef(slotId);
  slotIdRef.current = slotId;

  const roomNameRef = useRef(roomName);
  roomNameRef.current = roomName;

  const isLiveRef = useRef(state.isLive);
  isLiveRef.current = state.isLive;

  const isConnectedRef = useRef(state.isConnected);
  isConnectedRef.current = state.isConnected;

  const slotEndTimeRef = useRef(slotEndTime);
  slotEndTimeRef.current = slotEndTime;

  // Update state.roomName when prop changes (for consumers to check readiness)
  useEffect(() => {
    setState(prev => {
      if (prev.roomName !== roomName) {
        return { ...prev, roomName };
      }
      return prev;
    });
  }, [roomName]);

  // Check if someone else is already broadcasting
  // For recording mode with custom room, we skip this check since each user has their own room
  const checkRoomStatus = useCallback(async (): Promise<RoomStatus> => {
    const res = await fetch(`/api/livekit/room-status?room=${roomName}`);
    return res.json();
  }, [roomName]);

  // Connect to the LiveKit room
  // queueMode: when true, allows connecting even if another DJ is live (for pre-connect queue)
  const connect = useCallback(async (options?: { queueMode?: boolean }) => {
    const queueMode = options?.queueMode || false;
    // Use ref to get latest room name
    const currentRoomName = roomNameRef.current;

    // Safety check - if roomName is not set, don't try to connect
    if (!currentRoomName) {
      console.error('📡 ❌ Cannot connect: roomName is undefined');
      setState(prev => ({ ...prev, error: 'Room name not configured' }));
      return false;
    }

    console.log('📡 Connecting to room:', currentRoomName);

    try {
      setState(prev => ({ ...prev, error: null }));

      // Fetch room status and token in parallel to reduce connection time.
      // Room status check is skipped for recording mode (each user has their own room).
      console.log('📡 Requesting token for room:', currentRoomName, 'identity:', participantIdentity);
      const tokenPromise = fetch(
        `/api/livekit/token?room=${currentRoomName}&username=${encodeURIComponent(participantIdentity)}`
      ).then(r => r.json());
      const roomStatusPromise = !recordingOnly ? checkRoomStatus() : Promise.resolve(null);

      const [data, roomStatus] = await Promise.all([tokenPromise, roomStatusPromise]);

      // Check room status result (only for shared channel-radio room)
      if (roomStatus?.isLive) {
        // Allow the same DJ to reconnect (e.g. after pause/disconnect)
        // Only block if a *different* DJ is broadcasting (unless in queue mode)
        if (roomStatus.currentDJ !== participantIdentity) {
          if (queueMode) {
            // Queue mode: allow connection but store roomFreeAt for the waiting screen
            console.log('📡 Queue mode: connecting alongside current DJ:', roomStatus.currentDJ);
            setState(prev => ({
              ...prev,
              roomFreeAt: roomStatus.currentSlotEndTime || null,
            }));
          } else {
            setState(prev => ({
              ...prev,
              error: `Another DJ (${roomStatus.currentDJ}) is currently live`,
              roomOccupied: true,
              roomFreeAt: roomStatus.currentSlotEndTime || null,
            }));
            return false;
          }
        } else {
          console.log('📡 Same DJ reconnecting, allowing connection');
        }
      }

      console.log('📡 Token response:', { room: data.room, url: data.url, hasToken: !!data.token });

      if (data.error) {
        console.error('📡 Token error:', data.error);
        setState(prev => ({ ...prev, error: data.error }));
        return false;
      }

      // Connect to room
      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.Connected, () => {
        setState(prev => ({ ...prev, isConnected: true }));
      });

      room.on(RoomEvent.Disconnected, async (reason?: DisconnectReason) => {
        console.log('📡 Disconnected from room, reason:', reason);

        // If we were live and got disconnected unexpectedly, mark as paused
        // (not if DJ explicitly ended the broadcast)
        const wasLive = isLiveRef.current;
        const isUnexpectedDisconnect = reason !== DisconnectReason.CLIENT_INITIATED;
        const currentSlotId = slotIdRef.current;

        if (wasLive && isUnexpectedDisconnect && currentSlotId) {
          try {
            await fetch('/api/broadcast/pause-slot', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ slotId: currentSlotId }),
            });
            console.log('📡 Updated slot status to paused (unexpected disconnect):', currentSlotId);
          } catch (apiError) {
            console.error('Failed to update slot status to paused:', apiError);
          }
        }

        setState(prev => ({
          ...prev,
          isConnected: false,
          isPublishing: false,
          isLive: false,
        }));
        roomRef.current = null;
      });

      console.log('📡 Connecting to LiveKit URL:', data.url);
      await room.connect(data.url, data.token);

      // Wait for RoomEvent.Connected to fire (room.connect resolves on WebSocket open,
      // but track publishing requires the fully-connected state)
      if (room.state !== 'connected') {
        console.log('📡 Waiting for room to reach connected state...');
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Room connection timed out'));
          }, 10000);
          room.once(RoomEvent.Connected, () => {
            clearTimeout(timeout);
            resolve();
          });
          // Also resolve if already connected (race with event)
          if (room.state === 'connected') {
            clearTimeout(timeout);
            resolve();
          }
        });
      }

      console.log('📡 ✅ Successfully connected to room:', currentRoomName);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      setState(prev => ({ ...prev, error: message }));
      return false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- state.isLive intentionally omitted; disconnect handler uses isLiveRef instead
  }, [participantIdentity, checkRoomStatus, recordingOnly]);

  // Publish audio to the room
  const publishAudio = useCallback(async (stream: MediaStream) => {
    if (!roomRef.current) {
      setState(prev => ({ ...prev, error: 'Not connected to room' }));
      return false;
    }

    try {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        setState(prev => ({ ...prev, error: 'No audio track found' }));
        return false;
      }

      // Bound publishTrack with a timeout — if the SFU is still holding the
      // previous DJ's publish slot, this can otherwise hang indefinitely and
      // leave the UI stuck on "Connecting…".
      const publishPromise = roomRef.current.localParticipant.publishTrack(audioTrack, {
        name: 'dj-audio',
        source: Track.Source.Microphone,
      });
      const publication = await Promise.race([
        publishPromise,
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error('Audio publish timed out — the room may still be releasing from the previous DJ. Try again in a few seconds.')),
            10_000,
          );
        }),
      ]);

      audioTrackRef.current = audioTrack as unknown as LocalTrack;

      // Monitor published track health — detect when audio silently dies
      const publishedTrack = publication?.track;
      if (publishedTrack) {
        publishedTrack.on(TrackEvent.Muted, () => {
          console.warn('📡 ⚠️ Published audio track was muted unexpectedly');
        });
        publishedTrack.on(TrackEvent.Ended, () => {
          console.error('📡 ❌ Published audio track ended unexpectedly');
          setState(prev => prev.isPublishing ? { ...prev, isPublishing: false, error: 'Audio track ended — click GO LIVE to restart' } : prev);
        });
      }

      // Also monitor the underlying MediaStreamTrack for 'ended' (device disconnect, browser stop)
      audioTrack.addEventListener('ended', () => {
        console.error('📡 ❌ Source audio track ended (device disconnected or browser stopped sharing)');
        setState(prev => prev.isPublishing ? { ...prev, isPublishing: false, error: 'Audio source disconnected — click GO LIVE to restart' } : prev);
      });

      setState(prev => ({ ...prev, isPublishing: true }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to publish audio';
      setState(prev => ({ ...prev, error: message }));
      return false;
    }
  }, []);

  // Start egress (go live or start recording)
  const startEgress = useCallback(async () => {
    // Use refs to get latest values
    const currentRoomName = roomNameRef.current;
    const currentBroadcastToken = broadcastTokenRef.current;
    const currentDjInfo = djInfoRef.current;

    try {
      console.log('📡 Starting egress for room:', currentRoomName, recordingOnly ? '(recording-only mode)' : '');
      const res = await fetchWithTimeout('/api/livekit/egress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: currentRoomName, recordingOnly, reuseHlsEgress: !recordingOnly }),
        timeoutMs: 15_000,
      });

      const data = await res.json();
      console.log('📡 Egress API response:', { status: res.status, data });

      if (data.error) {
        console.error('📡 ❌ Egress API returned error:', data.error);
        setState(prev => ({ ...prev, error: data.error }));
        return false;
      }

      // For recording-only mode, hlsUrl will be null
      const hlsUrl = recordingOnly ? null : (data.hlsUrl || `${r2PublicUrl}/${currentRoomName}/live.m3u8`);

      // Update Firestore slot status to 'live' via API (uses Admin SDK, no auth required)
      console.log('📡 broadcastToken value:', currentBroadcastToken);
      console.log('📡 Egress response:', { egressId: data.egressId, recordingEgressId: data.recordingEgressId });
      if (currentBroadcastToken) {
        try {
          console.log('📡 Calling go-live API with:', {
            broadcastToken: currentBroadcastToken?.slice(0, 10) + '...',
            djUsername: currentDjInfo?.username,
            djUserId: currentDjInfo?.userId,
            egressId: data.egressId,
            recordingEgressId: data.recordingEgressId,
          });
          const goLiveRes = await fetchWithTimeout('/api/broadcast/go-live', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              broadcastToken: currentBroadcastToken,
              djUsername: currentDjInfo?.username,
              djUserId: currentDjInfo?.userId,
              thankYouMessage: currentDjInfo?.thankYouMessage,
              egressId: data.egressId,
              recordingEgressId: data.recordingEgressId,
            }),
            timeoutMs: 15_000,
          });

          if (goLiveRes.ok) {
            const responseData = await goLiveRes.json();
            console.log('📡 ✅ Updated slot status to live:', responseData);
          } else {
            const errorData = await goLiveRes.json();
            console.error('📡 ❌ Failed to update slot status:', errorData.error);
          }
        } catch (apiError) {
          console.error('📡 ❌ Failed to update slot status:', apiError);
          // Don't fail the broadcast if status update fails
        }
      } else {
        console.warn('📡 ⚠️ No broadcastToken provided - slot status will NOT be updated to live!');
      }

      setState(prev => ({
        ...prev,
        isLive: true,
        egressId: data.egressId,
        recordingEgressId: data.recordingEgressId || null,
        hlsUrl,
      }));

      return true;
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const message = isAbort
        ? 'Stream start timed out — the previous broadcast may not have fully ended. Try again.'
        : (error instanceof Error ? error.message : 'Failed to start stream');
      setState(prev => ({ ...prev, error: message }));
      return false;
    }
  }, [recordingOnly]);  // Only depends on recordingOnly since we use refs for other values

  // Go live - connect, publish, and start egress
  const goLive = useCallback(async (stream: MediaStream) => {
    // Use ref to avoid recreating this callback when isConnected changes mid-flow
    if (!isConnectedRef.current) {
      const connected = await connect();
      if (!connected) return false;
    }

    // Verify the room is actually in connected state before publishing
    if (!roomRef.current || roomRef.current.state !== 'connected') {
      console.error('📡 ❌ Room not in connected state after connect():', roomRef.current?.state);
      setState(prev => ({ ...prev, error: 'Room connection not ready — please try again' }));
      return false;
    }

    // Verify the audio stream still has live tracks (can die between capture and go-live)
    const liveTracks = stream.getAudioTracks().filter(t => t.readyState === 'live');
    if (liveTracks.length === 0) {
      console.error('📡 ❌ Audio stream has no live tracks — source may have been disconnected');
      setState(prev => ({ ...prev, error: 'Audio source disconnected — please recapture audio' }));
      return false;
    }

    // Publish audio
    const published = await publishAudio(stream);
    if (!published) return false;

    // Brief pause to let the SFU acknowledge the published track
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify track was actually published to the room
    const publications = roomRef.current?.localParticipant?.audioTrackPublications;
    if (!publications || publications.size === 0) {
      console.error('📡 ❌ Track publish succeeded locally but no publications found on participant');
      setState(prev => ({ ...prev, error: 'Audio publish failed — please try again' }));
      return false;
    }

    // Start egress
    const started = await startEgress();
    return started;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- isConnected read via ref to keep callback stable during async flow
  }, [connect, publishAudio, startEgress]);

  // Stop egress (both HLS and recording, or just recording in recording-only mode)
  // keepHlsEgress: when true, leave HLS egress running for seamless DJ transitions
  const stopEgress = useCallback(async (options?: { keepHlsEgress?: boolean }) => {
    // Use ref to get latest slotId
    const currentSlotId = slotIdRef.current;
    const keepHls = options?.keepHlsEgress || false;

    // In recording-only mode, we only have recordingEgressId (no HLS egressId)
    if (!state.egressId && !state.recordingEgressId) return;

    try {
      // Stop HLS egress if it exists (not in recording-only mode)
      // Skip if keepHlsEgress is true (seamless DJ transition — next DJ reuses it)
      if (state.egressId && !keepHls) {
        await fetch('/api/livekit/egress', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ egressId: state.egressId }),
        });
      } else if (state.egressId && keepHls) {
        console.log('📡 Keeping HLS egress alive for DJ transition:', state.egressId);
      }

      // Stop recording egress if it exists
      if (state.recordingEgressId) {
        try {
          await fetch('/api/livekit/egress', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ egressId: state.recordingEgressId }),
          });
          console.log('📡 Stopped recording egress:', state.recordingEgressId);
        } catch (recordingError) {
          console.error('Failed to stop recording egress:', recordingError);
        }
      }

      // Update Firestore slot status to 'completed' via API
      // force: true allows completing before scheduled end time (DJ ended early)
      if (currentSlotId) {
        try {
          await fetch('/api/broadcast/complete-slot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slotId: currentSlotId, force: true }),
          });
          console.log('📡 Updated slot status to completed:', currentSlotId);
        } catch (apiError) {
          console.error('Failed to update slot status:', apiError);
        }
      }

      setState(prev => ({
        ...prev,
        isLive: false,
        egressId: null,
        recordingEgressId: null,
      }));
    } catch (error) {
      console.error('Failed to stop egress:', error);
    }
  }, [state.egressId, state.recordingEgressId]);

  // Unpublish audio
  const unpublishAudio = useCallback(async () => {
    if (!roomRef.current) {
      audioTrackRef.current = null;
      setState(prev => ({ ...prev, isPublishing: false }));
      return;
    }

    try {
      const publication = roomRef.current.localParticipant.audioTrackPublications.values().next().value;
      if (publication?.track) {
        await roomRef.current.localParticipant.unpublishTrack(publication.track);
      }
    } catch (error) {
      // Ignore errors during cleanup - track may already be unpublished
      console.log('📡 Unpublish cleanup (expected during end):', error);
    }

    audioTrackRef.current = null;
    setState(prev => ({ ...prev, isPublishing: false }));
  }, []);

  // Disconnect from room
  const disconnect = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    setState(prev => ({
      ...prev,
      isConnected: false,
      isPublishing: false,
    }));
  }, []);

  // End broadcast completely
  // keepHlsEgress: when true, leave HLS egress running for seamless DJ transitions
  const endBroadcast = useCallback(async (options?: { keepHlsEgress?: boolean }) => {
    await stopEgress(options);
    await unpublishAudio();
    disconnect();
    setState(prev => ({
      ...prev,
      isLive: false,
      egressId: null,
      recordingEgressId: null,
      hlsUrl: null,
    }));
  }, [stopEgress, unpublishAudio, disconnect]);

  // Set input method
  const setInputMethod = useCallback((method: BroadcastState['inputMethod']) => {
    setState(prev => ({ ...prev, inputMethod: method }));
  }, []);

  // Queue to go live: pre-connect with muted audio, auto-activate when room clears
  const queueGoLive = useCallback(async (stream: MediaStream) => {
    console.log('📡 Queueing to go live (pre-connect with muted audio)');

    // Connect in queue mode (bypasses roomOccupied block)
    const connected = await connect({ queueMode: true });
    if (!connected) return false;

    // Publish audio then immediately mute
    const published = await publishAudio(stream);
    if (!published) return false;

    if (roomRef.current) {
      await roomRef.current.localParticipant.setMicrophoneEnabled(false);
      console.log('📡 Audio published and muted (queued)');
    }

    setState(prev => ({ ...prev, isQueued: true, roomOccupied: false }));

    // Poll room status every 3s to detect when room clears
    queuePollRef.current = setInterval(async () => {
      try {
        const status = await checkRoomStatus();
        if (!status.isLive) {
          console.log('📡 Room cleared! Auto-activating queued DJ');

          // Stop polling
          if (queuePollRef.current) {
            clearInterval(queuePollRef.current);
            queuePollRef.current = null;
          }

          // Show "going live" screen
          setState(prev => ({ ...prev, isQueued: false, isGoingLive: true }));

          // Unmute audio
          if (roomRef.current) {
            await roomRef.current.localParticipant.setMicrophoneEnabled(true);
            console.log('📡 Audio unmuted');
          }

          // Start egress and go live
          await startEgress();

          setState(prev => ({ ...prev, isGoingLive: false }));
        }
      } catch (err) {
        console.error('📡 Queue poll error:', err);
      }
    }, 3000);

    return true;
  }, [connect, publishAudio, checkRoomStatus, startEgress]);

  // Cancel queue: stop polling, disconnect from room
  const cancelQueue = useCallback(() => {
    console.log('📡 Cancelling queue');
    if (queuePollRef.current) {
      clearInterval(queuePollRef.current);
      queuePollRef.current = null;
    }
    unpublishAudio();
    disconnect();
    setState(prev => ({
      ...prev,
      isQueued: false,
      isGoingLive: false,
      roomOccupied: false,
      roomFreeAt: null,
    }));
  }, [unpublishAudio, disconnect]);

  // Clean up queue poll on unmount
  useEffect(() => {
    return () => {
      if (queuePollRef.current) {
        clearInterval(queuePollRef.current);
        queuePollRef.current = null;
      }
    };
  }, []);

  // Clear error (and room-occupied state)
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null, roomOccupied: false, roomFreeAt: null }));
  }, []);

  // Handle browser close/tab close
  // For recordings: stop the egress completely (end the recording)
  // For live broadcasts: mark as paused (DJ may reconnect)
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable delivery on page unload
      if (state.isLive && slotId) {
        if (recordingOnly) {
          // For recordings, stop the egress and complete the slot
          // This ensures the recording is finalized when the user closes the window
          navigator.sendBeacon(
            '/api/recording/stop',
            JSON.stringify({ slotId, egressId: state.recordingEgressId })
          );
        } else {
          // If the slot is ending (within 2 min of scheduled end, or already
          // past), fire complete-slot so the LiveKit room is released
          // immediately and the next show's handoff fires. Threshold matches
          // the server-side NEAR_END_GRACE_MS in complete-slot/route.ts —
          // closing the tab and clicking End should produce the same outcome.
          const endTime = slotEndTimeRef.current;
          const nearEnd = typeof endTime === 'number' && Date.now() >= endTime - 120_000;
          if (nearEnd) {
            navigator.sendBeacon(
              '/api/broadcast/complete-slot',
              JSON.stringify({ slotId, force: true })
            );
          } else {
            // Mid-slot disconnect — mark as paused so the DJ can reconnect.
            navigator.sendBeacon(
              '/api/broadcast/pause-slot',
              JSON.stringify({ slotId })
            );
          }
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.isLive, slotId, recordingOnly, state.recordingEgressId]);

  return {
    ...state,
    connect,
    publishAudio,
    goLive,
    endBroadcast,
    disconnect,
    setInputMethod,
    clearError,
    checkRoomStatus,
    queueGoLive,
    cancelQueue,
  };
}
