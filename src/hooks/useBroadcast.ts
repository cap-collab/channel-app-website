'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Room, RoomEvent, Track, LocalTrack, DisconnectReason, TrackEvent } from 'livekit-client';
import { BroadcastState, ROOM_NAME, RoomStatus, RedChannelChoice } from '@/types/broadcast';
import { usePublisherStats } from './usePublisherStats';

const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';

/**
 * True when the room's local participant has a LIVE, UNMUTED audio publication —
 * i.e. audio is actually flowing right now. This is the correct recovery signal
 * after a glitch: the source MediaStreamTrack that fired `ended` is terminal and
 * never revives, but LiveKit re-publishes a fresh track when the device/connection
 * recovers (the Jane/Bilaliwood 2026-06 pattern). Judging by the room publication
 * — not the dead source track — is what tells us the blip self-healed.
 */
export function isRoomAudioHealthy(room: Room | null): boolean {
  if (!room) return false;
  const pubs = room.localParticipant?.audioTrackPublications;
  if (!pubs || pubs.size === 0) return false;
  return Array.from(pubs.values()).some(pub => {
    if (pub.isMuted) return false;
    const mst = pub.track?.mediaStreamTrack;
    return !!mst && mst.readyState === 'live';
  });
}

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
  redChannelChoice: RedChannelChoice = 'stereo',
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
  // Debounce timer for transient audio-track failures. A brief glitch (device
  // hiccup, sample-rate renegotiation, OS audio interruption) fires the track's
  // `ended`/`mute` event even though the recording egress keeps running. We wait
  // TRACK_RECOVERY_GRACE_MS before surfacing "restart" so a momentary blip
  // doesn't prompt the DJ to restart (a restart re-joins as a duplicate identity
  // and splits the recording — see Jane/Bilaliwood 2026-06). Cleared if audio
  // recovers, on a successful republish, or on unmount.
  const trackRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Matches the broadcast-teardown grace in BroadcastClient so the restart prompt
  // and the actual end-of-broadcast happen at the same moment, not 2s apart.
  const TRACK_RECOVERY_GRACE_MS = 5000;
  // The live audio publication + the deviceId/channel constraints used to capture
  // it, so an audio glitch can be self-healed: re-capture the SAME device and
  // replaceTrack() it into the existing publication (no egress restart → the
  // recording stays one continuous file). Set on publish, used during recovery.
  const audioPublicationRef = useRef<import('livekit-client').LocalTrackPublication | null>(null);
  const captureConstraintsRef = useRef<MediaTrackConstraints | null>(null);
  const recoveringRef = useRef(false);
  // Callback the page registers so we can hand it the recovered MediaStream after
  // a self-heal — the DJ console's level meters read the page's audioStream, which
  // otherwise still points at the dead source track (meter stays flat).
  const onAudioRecoveredRef = useRef<((stream: MediaStream) => void) | null>(null);
  const setOnAudioRecovered = useCallback((cb: ((stream: MediaStream) => void) | null) => {
    onAudioRecoveredRef.current = cb;
  }, []);

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

  // DJ's Stream Optimization choice (mono / stereo / unsure). Mirrored into a
  // ref so the publish decision reads a synchronous, always-current value —
  // never gated by a Firebase read.
  const redChannelChoiceRef = useRef(redChannelChoice);
  redChannelChoiceRef.current = redChannelChoice;

  // Selected audio input method, mirrored for the publish decision (publishAudio
  // is a stable useCallback so it can't read state.inputMethod directly).
  const inputMethodRef = useRef(state.inputMethod);
  inputMethodRef.current = state.inputMethod;

  // The resolved RED decision from publishAudio — 'stereo-forced' when red:true
  // was sent, 'sdk-default' when the option was omitted. Stashed here so
  // startEgress can report it to the go-live API for persistence on the slot.
  const resolvedRedModeRef = useRef<'stereo-forced' | 'sdk-default'>('sdk-default');

  // Telemetry — polls WebRTC stats during broadcast, no-op when flag disabled.
  // Wrapped in its own hook with try/catch — cannot affect publish.
  const publisherStats = usePublisherStats(roomRef.current, state.isLive);

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

      // RED decision. Baseline: omit the `red` option entirely and let the
      // LiveKit SDK default apply — RED automatically on for mono tracks, off
      // for stereo tracks. The ONLY override: force `red: true` when the DJ is
      // streaming from gear AND explicitly picked Stereo in the Stream
      // Optimization panel. Forced stereo RED on mono-summed content (L=R)
      // causes audible bleed (verified 2026-05-13 against protectynggirls + 6
      // historical recordings) — the panel's warnings cover that risk; the DJ's
      // choice is honoured rather than silently overridden.
      const forceStereoRed =
        inputMethodRef.current === 'device' && redChannelChoiceRef.current === 'stereo';
      // Stash the resolved decision so startEgress can persist it on the slot.
      resolvedRedModeRef.current = forceStereoRed ? 'stereo-forced' : 'sdk-default';
      console.log('📡 Publishing audio — inputMethod:', inputMethodRef.current, 'redChannelChoice:', redChannelChoiceRef.current, 'forceStereoRed:', forceStereoRed);

      const publishPromise = roomRef.current.localParticipant.publishTrack(audioTrack, {
        name: 'dj-audio',
        source: Track.Source.Microphone,
        ...(forceStereoRed ? { red: true } : {}),
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
      audioPublicationRef.current = publication;
      // Remember exactly which device + channel layout we captured, so recovery
      // re-grabs the SAME input rather than the OS default.
      const s = audioTrack.getSettings();
      captureConstraintsRef.current = {
        ...(s.deviceId ? { deviceId: { exact: s.deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: { ideal: 48000 },
        channelCount: { min: 1, ideal: 2 },
      };

      // A new publish supersedes any pending recovery countdown.
      if (trackRecoveryTimerRef.current) {
        clearTimeout(trackRecoveryTimerRef.current);
        trackRecoveryTimerRef.current = null;
      }

      // ACTIVE self-heal on an audio glitch. A glitch fires `ended` on the source
      // MediaStreamTrack, which is TERMINAL — it never revives, and because the
      // track is user-provided LiveKit won't re-acquire it on its own (so audio
      // would stay dead even though the egress keeps running — confirmed in
      // testing 2026-06-11). So we actively re-capture the SAME device and
      // replaceTrack() it into the EXISTING publication: no egress restart, the
      // recording stays one continuous file, levels come back. We retry across
      // the grace window (a USB device can take a couple seconds to re-enumerate),
      // and only prompt for a manual restart if every attempt fails.
      const attemptRecovery = async (reason: string, message: string) => {
        if (recoveringRef.current) return; // already recovering
        if (!isLiveRef.current) return;    // not live — nothing to heal
        recoveringRef.current = true;
        console.warn(`📡 ⚠️ ${reason} — attempting to re-acquire the device and replace the live track`);
        const deadline = Date.now() + TRACK_RECOVERY_GRACE_MS;
        try {
          while (Date.now() < deadline) {
            // Already healthy (e.g. LiveKit recovered, or a prior attempt took)?
            if (isRoomAudioHealthy(roomRef.current)) {
              console.log('📡 ✅ Room audio healthy — recovery complete');
              return;
            }
            const pub = audioPublicationRef.current;
            const constraints = captureConstraintsRef.current;
            if (pub && constraints) {
              try {
                const fresh = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
                const newTrack = fresh.getAudioTracks()[0];
                const localTrack = pub.track as unknown as { replaceTrack?: (t: MediaStreamTrack) => Promise<unknown> } | undefined;
                if (newTrack && newTrack.readyState === 'live' && localTrack?.replaceTrack) {
                  await localTrack.replaceTrack(newTrack);
                  audioTrackRef.current = pub.track as unknown as LocalTrack;
                  // Re-arm the ended listener on the NEW source track.
                  newTrack.addEventListener('ended', () => {
                    void attemptRecovery('Source audio track ended again', message);
                  });
                  console.log('📡 ✅ Re-acquired device and replaced the live track — recording continuous');
                  setState(prev => prev.isPublishing ? prev : { ...prev, isPublishing: true });
                  // Hand the recovered stream to the page so the DJ console level
                  // meters track live audio again (they read the page's audioStream,
                  // which still pointed at the dead source track).
                  onAudioRecoveredRef.current?.(fresh);
                  return;
                }
                // got a stream but not live — drop it and retry
                fresh.getTracks().forEach(t => t.stop());
              } catch (e) {
                console.warn('📡 recovery getUserMedia/replaceTrack attempt failed, retrying…', (e as Error)?.name || e);
              }
            }
            await new Promise(r => setTimeout(r, 1000)); // wait before next attempt
          }
          // Every attempt failed within the window — the device is genuinely gone
          // (not a glitch). Signal a hard audio failure: BroadcastClient ends the
          // broadcast and drops the DJ back to the audio-input picker, where this
          // error is shown so they can reconnect their device and go live again.
          if (!isRoomAudioHealthy(roomRef.current)) {
            console.error(`📡 ❌ Could not re-acquire audio within ${TRACK_RECOVERY_GRACE_MS}ms — ending broadcast, DJ must re-select input`);
            setState(prev => ({ ...prev, isPublishing: false, audioRecoveryFailed: true, error: message }));
          }
        } finally {
          recoveringRef.current = false;
        }
      };

      // Monitor published track health — detect when audio silently dies
      const publishedTrack = publication?.track;
      if (publishedTrack) {
        publishedTrack.on(TrackEvent.Muted, () => {
          // Mute/unmute churn is routine and recovers on its own — never prompt.
          console.warn('📡 ⚠️ Published audio track was muted (transient — not prompting)');
        });
        publishedTrack.on(TrackEvent.Ended, () => {
          void attemptRecovery('Published audio track ended', 'Your audio device stopped responding. Reconnect it, re-select your audio input, and start your broadcast again.');
        });
      }

      // Also monitor the underlying MediaStreamTrack for 'ended' (device disconnect, browser stop)
      audioTrack.addEventListener('ended', () => {
        void attemptRecovery('Source audio track ended (device disconnected or browser stopped sharing)', 'Your audio device stopped responding. Reconnect it, re-select your audio input, and start your broadcast again.');
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
              // Best-effort persistence of the DJ's Stream Optimization choice
              // and the resolved RED decision applied at publish; the go-live
              // API write is already non-blocking (see catch below).
              redChannelChoice: redChannelChoiceRef.current,
              redMode: resolvedRedModeRef.current,
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
    // Fresh go-live — clear any prior audio-recovery failure + its error banner.
    setState(prev => (prev.audioRecoveryFailed || prev.error) ? { ...prev, audioRecoveryFailed: false, error: null } : prev);
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
    // Snapshot stats payload BEFORE the room is torn down (sender becomes
    // unavailable after disconnect). Send is fire-and-forget AFTER critical
    // path so it can never block complete-slot / unpublish / disconnect.
    let statsPayload: ReturnType<typeof publisherStats.flush> = null;
    try { statsPayload = publisherStats.flush(); } catch { /* swallow */ }

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

    // Fire-and-forget telemetry write. Never throws, never blocks.
    const currentSlotId = slotIdRef.current;
    if (statsPayload && currentSlotId) {
      void fetch('/api/broadcast/log-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: currentSlotId, stats: statsPayload }),
        keepalive: true,
      }).catch(() => { /* telemetry failure is non-fatal */ });
    }
  }, [stopEgress, unpublishAudio, disconnect, publisherStats]);

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
      if (trackRecoveryTimerRef.current) {
        clearTimeout(trackRecoveryTimerRef.current);
        trackRecoveryTimerRef.current = null;
      }
      // Stop any in-flight audio re-acquire loop.
      recoveringRef.current = false;
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
    setOnAudioRecovered,
  };
}
