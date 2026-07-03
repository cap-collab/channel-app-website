import { EgressClient, RoomServiceClient } from 'livekit-server-sdk';
import { SegmentedFileOutput, SegmentedFileProtocol, S3Upload, EncodedFileOutput, EncodedFileType } from '@livekit/protocol';
import { NextRequest, NextResponse } from 'next/server';

const livekitHost = process.env.LIVEKIT_URL?.replace('wss://', 'https://') || '';
const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';

// R2 config (S3-compatible)
const r2AccountId = process.env.R2_ACCOUNT_ID || '';
const r2AccessKey = process.env.R2_ACCESS_KEY_ID || '';
const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2Bucket = process.env.R2_BUCKET_NAME || '';
const r2Endpoint = `https://${r2AccountId}.r2.cloudflarestorage.com`;
const r2PublicUrl = process.env.R2_PUBLIC_URL || '';

/** Find the first published audio track SID in a room. */
async function findAudioTrackSid(room: string): Promise<string | null> {
  try {
    const roomService = new RoomServiceClient(livekitHost, apiKey, apiSecret);
    const participants = await roomService.listParticipants(room);
    for (const p of participants) {
      for (const t of p.tracks) {
        if (t.type === 1 /* AUDIO */ && !t.muted && t.sid) {
          return t.sid;
        }
      }
    }
  } catch (err) {
    console.warn('Failed to find audio track SID:', err);
  }
  return null;
}

// ── NEW (this session): helpers for the independent track-composite recording ──
// These are used ONLY by the new parallel recording and touch nothing else.
// Gated by RECORDING_TRACK_COMPOSITE (default ON; set =0 to disable entirely).
const TRACK_COMPOSITE_ENABLED = process.env.RECORDING_TRACK_COMPOSITE !== '0'
  && process.env.RECORDING_TRACK_COMPOSITE !== 'false';
const TRACK_LOOKUP_TOTAL_BUDGET_MS = 1200; // hard cap on all polling combined
const TRACK_LOOKUP_POLL_INTERVAL_MS = 250;
const TRACK_LOOKUP_CALL_TIMEOUT_MS = 500;  // per listParticipants call

/**
 * Poll briefly for the DJ's published audio track SID, for the NEW track-composite
 * recording only. The DJ's track often isn't server-visible the instant egress
 * starts (publish→registration race), so a one-shot lookup usually misses it.
 * Best-effort: returns null on ANY failure / if not found within the budget.
 * Never throws, never blocks past the budget. Separate from findAudioTrackSid so
 * the existing recording paths keep their exact original one-shot behavior.
 */
async function findAudioTrackSidForNewRecording(room: string): Promise<string | null> {
  const deadline = Date.now() + TRACK_LOOKUP_TOTAL_BUDGET_MS;
  const roomService = new RoomServiceClient(livekitHost, apiKey, apiSecret);
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const participants = await Promise.race([
        roomService.listParticipants(room),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), Math.min(TRACK_LOOKUP_CALL_TIMEOUT_MS, Math.max(0, deadline - Date.now()))),
        ),
      ]);
      for (const p of participants) {
        for (const t of p.tracks) {
          if (t.type === 1 /* AUDIO */ && !t.muted && t.sid) {
            console.log(`[track-recording] found audio track on attempt ${attempt} (${t.sid})`);
            return t.sid;
          }
        }
      }
    } catch (err) {
      console.warn(`[track-recording] track lookup attempt ${attempt} failed (non-fatal):`, (err as Error).message);
    }
    if (Date.now() + TRACK_LOOKUP_POLL_INTERVAL_MS >= deadline) break;
    await new Promise((r) => setTimeout(r, TRACK_LOOKUP_POLL_INTERVAL_MS));
  }
  console.log(`[track-recording] no audio track within ${TRACK_LOOKUP_TOTAL_BUDGET_MS}ms budget → skipping`);
  return null;
}

// Start HLS + MP4 egress for a room (or MP4-only for recording mode)
export async function POST(request: NextRequest) {
  try {
    const { room, recordingOnly, reuseHlsEgress } = await request.json();

    if (!room) {
      return NextResponse.json({ error: 'Room name required' }, { status: 400 });
    }

    if (!r2AccessKey || !r2SecretKey) {
      return NextResponse.json({ error: 'R2 storage not configured' }, { status: 500 });
    }

    const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);

    // Recording-only mode: Skip HLS, only start MP4 recording
    if (recordingOnly) {
      console.log('Starting MP4-only egress for recording room:', room);

      const recordingS3Upload = new S3Upload({
        accessKey: r2AccessKey,
        secret: r2SecretKey,
        bucket: r2Bucket,
        region: 'auto',
        endpoint: r2Endpoint,
        forcePathStyle: true,
      });

      const mp4Output = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath: `recordings/${room}/{room_name}-{time}.mp4`,
        output: {
          case: 's3',
          value: recordingS3Upload,
        },
      });

      // Use track composite egress for MP4 recording — encodes the audio track
      // directly via GStreamer instead of running a headless Chrome compositor,
      // which eliminates periodic pops/frame drops in recordings.
      const audioTrackSid = await findAudioTrackSid(room);
      const recordingEgress = audioTrackSid
        ? await egressClient.startTrackCompositeEgress(
            room,
            { file: mp4Output },
            { audioTrackId: audioTrackSid }
          )
        : await egressClient.startRoomCompositeEgress(
            room,
            { file: mp4Output },
            { audioOnly: true }
          );

      console.log(`MP4 recording egress started (recording-only, ${audioTrackSid ? 'track-composite' : 'room-composite'}):`, recordingEgress.egressId);

      return NextResponse.json({
        egressId: null,  // No HLS egress in recording-only mode
        recordingEgressId: recordingEgress.egressId,
        status: recordingEgress.status,
        room,
        hlsUrl: null,  // No HLS stream
        message: 'MP4 recording started (recording-only mode)',
      });
    }

    // Standard live broadcast mode: HLS + MP4

    // Check for existing egresses. When reuseHlsEgress is true (DJ transition),
    // keep the first active egress (the HLS stream) for seamless handoff.
    // Otherwise stop all stale egresses (original behavior).
    //
    // DIAGNOSTIC LOGGING (behavior unchanged): this sweep identifies the HLS
    // egress to keep by "first active in the list", not by output type. With the
    // parallel track recording there can be up to 3 active egresses (HLS + room
    // recording + track recording), and listEgress ordering isn't guaranteed. If
    // the "first" ever turns out to be a recording (file output) rather than the
    // HLS (segments), keeping it would strand listeners. The logs below classify
    // every egress and LOUDLY warn if that race is about to happen — so we can
    // see from console whether it ever actually occurs in prod before deciding to
    // harden the sweep. We do NOT change what gets kept/stopped here.
    const egressKindLabel = (e: { request?: { case?: string; value?: unknown } }): string => {
      const v = (e.request?.value ?? {}) as { segmentOutputs?: unknown[]; fileOutputs?: unknown[]; output?: { case?: string } };
      const isSegments = !!v.segmentOutputs?.length || v.output?.case === 'segments';
      const isFile = !!v.fileOutputs?.length || v.output?.case === 'file';
      if (isSegments) return 'HLS(segments)';
      if (isFile) return 'RECORDING(file)';
      return `unknown(case=${e.request?.case ?? '?'})`;
    };
    let existingHlsEgressId: string | null = null;
    try {
      const existingEgresses = await egressClient.listEgress({ roomName: room });
      const activeList = existingEgresses.filter((e) => e.status === 0 || e.status === 1);
      console.log(`[egress-sweep] room=${room} reuseHlsEgress=${reuseHlsEgress} — ${activeList.length} active egress(es):`,
        activeList.map((e) => `${e.egressId}:${egressKindLabel(e)}`).join(', ') || '(none)');
      for (const egress of existingEgresses) {
        // Only process active egresses (status 0=STARTING, 1=ACTIVE)
        if (egress.status === 0 || egress.status === 1) {
          const kind = egressKindLabel(egress);
          if (reuseHlsEgress && !existingHlsEgressId) {
            // Keep the first active egress (the HLS stream from previous DJ)
            existingHlsEgressId = egress.egressId;
            if (kind !== 'HLS(segments)') {
              console.warn(`[egress-sweep] ⚠️ RACE: keeping ${egress.egressId} as HLS for reuse, but it is ${kind} — the real HLS may get stopped, stranding listeners. (Recording lifecycles are ID-managed, so files are safe.)`);
            } else {
              console.log(`[egress-sweep] Reusing HLS egress for DJ transition: ${egress.egressId} (${kind})`);
            }
          } else {
            // Stop stale or extra egresses
            console.log(`[egress-sweep] Stopping egress ${egress.egressId} (${kind})`);
            try {
              await egressClient.stopEgress(egress.egressId);
            } catch (stopErr) {
              console.warn('Failed to stop stale egress (may already be stopping):', egress.egressId, stopErr);
            }
          }
        }
      }
    } catch (listErr) {
      // Non-fatal - proceed with starting new egress
      console.warn('Failed to list existing egresses:', listErr);
    }

    // Reuse existing HLS egress if available (seamless DJ transition),
    // otherwise create a new one
    let hlsEgressId: string;
    if (existingHlsEgressId) {
      hlsEgressId = existingHlsEgressId;
      console.log('Reusing HLS egress from previous DJ:', hlsEgressId);
    } else {
      // Create S3Upload for R2
      const s3Upload = new S3Upload({
        accessKey: r2AccessKey,
        secret: r2SecretKey,
        bucket: r2Bucket,
        region: 'auto',
        endpoint: r2Endpoint,
        forcePathStyle: true,
      });

      // Create SegmentedFileOutput with proper protobuf structure
      // Use 6-second segments — reduces R2 write pressure (manifest overwritten every 6s
      // instead of 2s) which prevents the manifest from stalling on R2.
      const segmentOutput = new SegmentedFileOutput({
        protocol: SegmentedFileProtocol.HLS_PROTOCOL,
        filenamePrefix: `${room}/stream`,
        playlistName: 'playlist.m3u8',
        livePlaylistName: 'live.m3u8',
        segmentDuration: 6,
        output: {
          case: 's3',
          value: s3Upload,
        },
      });

      // Start room composite egress for HLS streaming
      console.log('Starting HLS egress for room:', room);
      try {
        const hlsEgress = await egressClient.startRoomCompositeEgress(
          room,
          { segments: segmentOutput },
          { audioOnly: true }
        );
        hlsEgressId = hlsEgress.egressId;
        console.log('HLS egress started:', hlsEgressId);
      } catch (hlsError) {
        console.error('Failed to start HLS egress:', hlsError);
        throw hlsError;
      }
    }

    // Start a second egress for MP4 file recording (works on iOS/Safari + SoundCloud)
    const recordingS3Upload = new S3Upload({
      accessKey: r2AccessKey,
      secret: r2SecretKey,
      bucket: r2Bucket,
      region: 'auto',
      endpoint: r2Endpoint,
      forcePathStyle: true,
    });

    const mp4Output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: `recordings/${room}/{room_name}-{time}.mp4`,
      output: {
        case: 's3',
        value: recordingS3Upload,
      },
    });

    let recordingEgressId: string | null = null;
    try {
      // Use track composite egress for MP4 recording — encodes the audio track
      // directly via GStreamer instead of running a headless Chrome compositor,
      // which eliminates periodic pops/frame drops in recordings.
      const audioTrackSid = await findAudioTrackSid(room);
      const recordingEgress = audioTrackSid
        ? await egressClient.startTrackCompositeEgress(
            room,
            { file: mp4Output },
            { audioTrackId: audioTrackSid }
          )
        : await egressClient.startRoomCompositeEgress(
            room,
            { file: mp4Output },
            { audioOnly: true }
          );
      recordingEgressId = recordingEgress.egressId;
      console.log(`MP4 recording egress started (${audioTrackSid ? 'track-composite' : 'room-composite'}):`, recordingEgressId);
    } catch (recordingError) {
      // Log but don't fail - HLS streaming is more important
      console.error('Failed to start MP4 recording egress:', recordingError);
    }

    // ── NEW, INDEPENDENT recording (this session) ────────────────────────────
    // A parallel track-composite recording of the DJ's audio track. It's an
    // ADDITIVE experiment that rides alongside the existing room recording as the
    // archive's `trackRecordingUrl` (never recordingUrl). It is completely
    // independent of and cannot affect the live stream OR the existing room
    // recording: it's its own egress, its own R2 key (`-track.mp4`), started here
    // and stopped only by its own id. ANY failure is swallowed. Gated by
    // RECORDING_TRACK_COMPOSITE (default ON; set =0 to disable entirely).
    let secondRecordingEgressId: string | null = null;
    if (TRACK_COMPOSITE_ENABLED) {
      try {
        const audioTrackSid = await findAudioTrackSidForNewRecording(room);
        if (audioTrackSid) {
          const trackMp4Output = new EncodedFileOutput({
            fileType: EncodedFileType.MP4,
            filepath: `recordings/${room}/{room_name}-{time}-track.mp4`,
            output: { case: 's3', value: recordingS3Upload },
          });
          const trackEgress = await egressClient.startTrackCompositeEgress(
            room,
            { file: trackMp4Output },
            { audioTrackId: audioTrackSid }
          );
          secondRecordingEgressId = trackEgress.egressId;
          console.log(`[track-recording] STARTED (independent) egressId=${secondRecordingEgressId} key=recordings/${room}/...-track.mp4`);
        } else {
          console.log('[track-recording] SKIPPED: no audio track SID within budget (existing recording unaffected)');
        }
      } catch (trackError) {
        // Purely best-effort — never affects the existing recording or live stream.
        console.error('[track-recording] FAILED (non-fatal, existing recording + live stream unaffected):', trackError);
      }
    }

    // Construct the HLS URL using public R2 subdomain
    const hlsUrl = `${r2PublicUrl}/${room}/live.m3u8`;

    return NextResponse.json({
      egressId: hlsEgressId,
      recordingEgressId,
      secondRecordingEgressId,
      status: existingHlsEgressId ? 1 : 0, // 1=ACTIVE (reused), 0=STARTING (new)
      room,
      hlsUrl,
      reusedHlsEgress: !!existingHlsEgressId,
      message: recordingEgressId ? 'HLS + MP4 recording started' : 'HLS egress started (recording failed)',
    });

  } catch (error: unknown) {
    console.error('Egress error:', error);
    const message = error instanceof Error ? error.message : 'Failed to start egress';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// List active egresses
export async function GET(request: NextRequest) {
  try {
    const room = request.nextUrl.searchParams.get('room');

    const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);
    const egresses = await egressClient.listEgress({ roomName: room || undefined });

    return NextResponse.json({
      egresses: egresses.map(e => ({
        egressId: e.egressId,
        status: e.status,
        roomName: e.roomName,
      })),
    });

  } catch (error: unknown) {
    console.error('List egress error:', error);
    const message = error instanceof Error ? error.message : 'Failed to list egresses';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Stop egress
export async function DELETE(request: NextRequest) {
  try {
    const { egressId } = await request.json();

    if (!egressId) {
      return NextResponse.json({ error: 'Egress ID required' }, { status: 400 });
    }

    const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);
    await egressClient.stopEgress(egressId);

    return NextResponse.json({ message: 'Egress stopped', egressId });

  } catch (error: unknown) {
    console.error('Stop egress error:', error);
    const message = error instanceof Error ? error.message : 'Failed to stop egress';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
