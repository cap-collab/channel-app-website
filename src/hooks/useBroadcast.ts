'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Room, RoomEvent, Track, LocalTrack, DisconnectReason } from 'livekit-client';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { BroadcastState, ROOM_NAME, RoomStatus } from '@/types/broadcast';

const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';

interface DJInfo {
  username: string;
  userId?: string;
}

export function useBroadcast(participantIdentity: string, slotId?: string, djInfo?: DJInfo) {
  const [state, setState] = useState<BroadcastState>({
    inputMethod: null,
    isConnected: false,
    isPublishing: false,
    isLive: false,
    egressId: null,
    hlsUrl: null,
    roomName: ROOM_NAME,
    error: null,
  });

  const roomRef = useRef<Room | null>(null);
  const audioTrackRef = useRef<LocalTrack | null>(null);

  // Check if someone else is already broadcasting
  const checkRoomStatus = useCallback(async (): Promise<RoomStatus> => {
    const res = await fetch(`/api/livekit/room-status?room=${ROOM_NAME}`);
    return res.json();
  }, []);

  // Connect to the LiveKit room
  const connect = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, error: null }));

      // Check if someone is already live
      const roomStatus = await checkRoomStatus();
      if (roomStatus.isLive) {
        setState(prev => ({
          ...prev,
          error: `Another DJ (${roomStatus.currentDJ}) is currently live`,
        }));
        return false;
      }

      // Get token
      const res = await fetch(
        `/api/livekit/token?room=${ROOM_NAME}&username=${encodeURIComponent(participantIdentity)}`
      );
      const data = await res.json();

      if (data.error) {
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

        if (wasLive && isUnexpectedDisconnect && slotId && db) {
          try {
            const slotRef = doc(db, 'broadcast-slots', slotId);
            await updateDoc(slotRef, { status: 'paused' });
            console.log('📡 Updated slot status to paused (unexpected disconnect):', slotId);
          } catch (firestoreError) {
            console.error('Failed to update slot status to paused:', firestoreError);
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

      await room.connect(data.url, data.token);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      setState(prev => ({ ...prev, error: message }));
      return false;
    }
  }, [participantIdentity, checkRoomStatus]);

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

  // Start egress (go live)
  const startEgress = useCallback(async () => {
    try {
      const res = await fetch('/api/livekit/egress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: ROOM_NAME }),
      });

      const data = await res.json();

      if (data.error) {
        setState(prev => ({ ...prev, error: data.error }));
        return false;
      }

      const hlsUrl = data.hlsUrl || `${r2PublicUrl}/${ROOM_NAME}/live.m3u8`;

      // Update Firestore slot status to 'live' and save DJ info
      if (slotId && db) {
        try {
          const slotRef = doc(db, 'broadcast-slots', slotId);
          const updateData: Record<string, string> = { status: 'live' };

          // Save DJ info when going live
          if (djInfo?.username) {
            updateData.liveDjUsername = djInfo.username;
          }
          if (djInfo?.userId) {
            updateData.liveDjUserId = djInfo.userId;
          }

          await updateDoc(slotRef, updateData);
          console.log('📡 Updated slot status to live with DJ info:', slotId, djInfo?.username);
        } catch (firestoreError) {
          console.error('Failed to update slot status:', firestoreError);
          // Don't fail the broadcast if Firestore update fails
        }
      }

      setState(prev => ({
        ...prev,
        isLive: true,
        egressId: data.egressId,
        hlsUrl,
      }));

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start stream';
      setState(prev => ({ ...prev, error: message }));
      return false;
    }
  }, [slotId, djInfo]);

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

  // Stop egress
  const stopEgress = useCallback(async () => {
    if (!state.egressId) return;

    try {
      await fetch('/api/livekit/egress', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ egressId: state.egressId }),
      });

      // Update Firestore slot status to 'completed'
      if (slotId && db) {
        try {
          const slotRef = doc(db, 'broadcast-slots', slotId);
          await updateDoc(slotRef, { status: 'completed' });
          console.log('📡 Updated slot status to completed:', slotId);
        } catch (firestoreError) {
          console.error('Failed to update slot status:', firestoreError);
        }
      }

      setState(prev => ({
        ...prev,
        isLive: false,
        egressId: null,
      }));
    } catch (error) {
      console.error('Failed to stop egress:', error);
    }
  }, [state.egressId, slotId]);

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

  // Handle browser close/tab close - mark as paused
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable delivery on page unload
      if (state.isLive && slotId) {
        navigator.sendBeacon(
          '/api/broadcast/pause-slot',
          JSON.stringify({ slotId })
        );
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.isLive, slotId]);

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
