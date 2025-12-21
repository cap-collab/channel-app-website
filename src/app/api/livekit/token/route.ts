import { AccessToken } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const room = request.nextUrl.searchParams.get('room') || 'test-room';
  const username = request.nextUrl.searchParams.get('username') || 'test-user';
  // Allow listener-only tokens (canPublish=false for iOS app listeners)
  const canPublish = request.nextUrl.searchParams.get('canPublish') !== 'false';

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: 'LiveKit credentials not configured' },
      { status: 500 }
    );
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: username,
    ttl: '1h',
  });

  at.addGrant({
    room,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
  });

  const token = await at.toJwt();

  return NextResponse.json({
    token,
    url: process.env.LIVEKIT_URL,
    room,
    username,
  });
}
