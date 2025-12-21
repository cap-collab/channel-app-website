import { EgressClient } from 'livekit-server-sdk';
import { SegmentedFileOutput, SegmentedFileProtocol, S3Upload } from '@livekit/protocol';
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

// Start HLS egress for a room
export async function POST(request: NextRequest) {
  try {
    const { room } = await request.json();

    if (!room) {
      return NextResponse.json({ error: 'Room name required' }, { status: 400 });
    }

    if (!r2AccessKey || !r2SecretKey) {
      return NextResponse.json({ error: 'R2 storage not configured' }, { status: 500 });
    }

    const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);

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

    // Start room composite egress
    const egress = await egressClient.startRoomCompositeEgress(
      room,
      { segments: segmentOutput },
      { audioOnly: true }
    );

    // Construct the HLS URL using public R2 subdomain
    const hlsUrl = `${r2PublicUrl}/${room}/live.m3u8`;

    return NextResponse.json({
      egressId: egress.egressId,
      status: egress.status,
      room,
      hlsUrl,
      message: 'HLS egress started',
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
