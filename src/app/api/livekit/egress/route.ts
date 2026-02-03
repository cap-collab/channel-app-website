import { EgressClient } from 'livekit-server-sdk';
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

// Start HLS + MP4 egress for a room (or MP4-only for recording mode)
export async function POST(request: NextRequest) {
  try {
    const { room, recordingOnly } = await request.json();

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

      const recordingEgress = await egressClient.startRoomCompositeEgress(
        room,
        { file: mp4Output },
        { audioOnly: true }
      );

      console.log('MP4 recording egress started (recording-only mode):', recordingEgress.egressId);

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
    // Use 2-second segments for lower latency (minimum stable duration)
    const segmentOutput = new SegmentedFileOutput({
      protocol: SegmentedFileProtocol.HLS_PROTOCOL,
      filenamePrefix: `${room}/stream`,
      playlistName: 'playlist.m3u8',
      livePlaylistName: 'live.m3u8',
      segmentDuration: 2,
      output: {
        case: 's3',
        value: s3Upload,
      },
    });

    // Start room composite egress for HLS streaming
    console.log('Starting HLS egress for room:', room);
    let hlsEgress;
    try {
      hlsEgress = await egressClient.startRoomCompositeEgress(
        room,
        { segments: segmentOutput },
        { audioOnly: true }
      );
      console.log('HLS egress started:', hlsEgress.egressId);
    } catch (hlsError) {
      console.error('Failed to start HLS egress:', hlsError);
      throw hlsError;
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
      const recordingEgress = await egressClient.startRoomCompositeEgress(
        room,
        { file: mp4Output },
        { audioOnly: true }
      );
      recordingEgressId = recordingEgress.egressId;
      console.log('MP4 recording egress started:', recordingEgressId);
    } catch (recordingError) {
      // Log but don't fail - HLS streaming is more important
      console.error('Failed to start MP4 recording egress:', recordingError);
    }

    // Construct the HLS URL using public R2 subdomain
    const hlsUrl = `${r2PublicUrl}/${room}/live.m3u8`;

    return NextResponse.json({
      egressId: hlsEgress.egressId,
      recordingEgressId,
      status: hlsEgress.status,
      room,
      hlsUrl,
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
