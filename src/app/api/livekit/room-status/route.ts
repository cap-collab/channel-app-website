import { RoomServiceClient } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { ROOM_NAME, RoomStatus } from '@/types/broadcast';

const livekitHost = process.env.LIVEKIT_URL?.replace('wss://', 'https://') || '';
const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';

// GET - Check if the room has active broadcasters
export async function GET(request: NextRequest) {
  try {
    if (!livekitHost || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'LiveKit not configured' },
        { status: 500 }
      );
    }

    const room = request.nextUrl.searchParams.get('room') || ROOM_NAME;

    const roomService = new RoomServiceClient(livekitHost, apiKey, apiSecret);

    try {
      const participants = await roomService.listParticipants(room);

      // Check if any participant is publishing audio
      const publishingParticipants = participants.filter(p =>
        p.tracks.some(t =>
          t.type === 1 && // AUDIO type
          !t.muted
        )
      );

      const isLive = publishingParticipants.length > 0;
      const currentDJ = isLive ? publishingParticipants[0].identity : null;

      const status: RoomStatus = {
        isLive,
        currentDJ,
        participantCount: participants.length,
      };

      return NextResponse.json(status);
    } catch (error: unknown) {
      // Room might not exist yet - that's okay, means no one is live
      const errMessage = error instanceof Error ? error.message : String(error);
      if (errMessage.includes('room not found') || errMessage.includes('not found')) {
        const status: RoomStatus = {
          isLive: false,
          currentDJ: null,
          participantCount: 0,
        };
        return NextResponse.json(status);
      }
      throw error;
    }
  } catch (error) {
    console.error('Error checking room status:', error);
    return NextResponse.json(
      { error: 'Failed to check room status' },
      { status: 500 }
    );
  }
}
