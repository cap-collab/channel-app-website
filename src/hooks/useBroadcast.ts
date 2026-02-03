'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Room, RoomEvent, Track, LocalTrack, DisconnectReason } from 'livekit-client';
import { BroadcastState, ROOM_NAME, RoomStatus } from '@/types/broadcast';

const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';

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
  options?: BroadcastOptions
) {
  // Determine the room name to use
  const roomName = options?.customRoomName || ROOM_NAME;
  const recordingOnly = options?.recordingOnly || false;

  // Debug: log when hook params change
  console.log('📡 useBroadcast called with:', {
    participantIdentity,
    slotId,
    broadcastToken: broadcastToken ? broadcastToken.slice(0, 10) + '...' : undefined,
    customRoomName: options?.customRoomName,
    recordingOnly,
    computedRoomName: roomName,
  });

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
  });

  const roomRef = useRef<Room | null>(null);
  const audioTrackRef = useRef<LocalTrack | null>(null);

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

  // Update state.roomName when prop changes (for consumers to check readiness)
  useEffect(() => {
    console.log('📡 roomName changed:', roomName);
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
  const connect = useCallback(async () => {
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

      // For recording mode with custom room, skip the "someone already live" check
      // since each user has their own isolated room
      if (!recordingOnly) {
        // Check if someone is already live (only for shared channel-radio room)
        const roomStatus = await checkRoomStatus();
        if (roomStatus.isLive) {
          setState(prev => ({
            ...prev,
            error: `Another DJ (${roomStatus.currentDJ}) is currently live`,
          }));
          return false;
        }
      }

      // Get token for the room
      console.log('📡 Requesting token for room:', currentRoomName, 'identity:', participantIdentity);
      const res = await fetch(
        `/api/livekit/token?room=${currentRoomName}&username=${encodeURIComponent(participantIdentity)}`
      );
      const data = await res.json();
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
        const wasLive = state.isLive;
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
      console.log('📡 ✅ Successfully connected to room:', currentRoomName);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      setState(prev => ({ ...prev, error: message }));
      return false;
    }
  }, [participantIdentity, checkRoomStatus, state.isLive, recordingOnly]);

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

      await roomRef.current.localParticipant.publishTrack(audioTrack, {
        name: 'dj-audio',
        source: Track.Source.Microphone,
      });

      audioTrackRef.current = audioTrack as unknown as LocalTrack;
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
      const res = await fetch('/api/livekit/egress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: currentRoomName, recordingOnly }),
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
          const goLiveRes = await fetch('/api/broadcast/go-live', {
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
      const message = error instanceof Error ? error.message : 'Failed to start stream';
      setState(prev => ({ ...prev, error: message }));
      return false;
    }
  }, [recordingOnly]);  // Only depends on recordingOnly since we use refs for other values

  // Go live - connect, publish, and start egress
  const goLive = useCallback(async (stream: MediaStream) => {
    // Connect if not already
    if (!state.isConnected) {
      const connected = await connect();
      if (!connected) return false;
    }

    // Publish audio
    const published = await publishAudio(stream);
    if (!published) return false;

    // Start egress
    const started = await startEgress();
    return started;
  }, [state.isConnected, connect, publishAudio, startEgress]);

  // Stop egress (both HLS and recording, or just recording in recording-only mode)
  const stopEgress = useCallback(async () => {
    // Use ref to get latest slotId
    const currentSlotId = slotIdRef.current;

    // In recording-only mode, we only have recordingEgressId (no HLS egressId)
    if (!state.egressId && !state.recordingEgressId) return;

    try {
      // Stop HLS egress if it exists (not in recording-only mode)
      if (state.egressId) {
        await fetch('/api/livekit/egress', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ egressId: state.egressId }),
        });
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
    if (!roomRef.current || !audioTrackRef.current) return;

    try {
      const publication = roomRef.current.localParticipant.audioTrackPublications.values().next().value;
      if (publication?.track) {
        await roomRef.current.localParticipant.unpublishTrack(publication.track);
      }
      audioTrackRef.current = null;
      setState(prev => ({ ...prev, isPublishing: false }));
    } catch (error) {
      console.error('Failed to unpublish audio:', error);
    }
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
  const endBroadcast = useCallback(async () => {
    await stopEgress();
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

  // Clear error
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
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
          // For live broadcasts, just mark as paused (DJ may reconnect)
          navigator.sendBeacon(
            '/api/broadcast/pause-slot',
            JSON.stringify({ slotId })
          );
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
  };
}
