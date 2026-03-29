import { RoomServiceClient, IngressClient, EgressClient } from 'livekit-server-sdk';
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
    const debug = request.nextUrl.searchParams.get('debug') === 'true';

    const roomService = new RoomServiceClient(livekitHost, apiKey, apiSecret);

    try {
      const participants = await roomService.listParticipants(room);

      // Check if any participant is publishing unmuted tracks
      // TrackType enum: AUDIO=0, VIDEO=1, DATA=2
      const publishingParticipants = participants.filter(p =>
        p.tracks.some(t => !t.muted)
      );

      const isLive = publishingParticipants.length > 0;
      const currentDJ = isLive ? publishingParticipants[0].identity : null;

      // Debug mode: show full room, ingress, and egress details
      if (debug) {
        const ingressClient = new IngressClient(livekitHost, apiKey, apiSecret);
        const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);

        let ingresses: unknown[] = [];
        let egresses: unknown[] = [];
        try {
          const ingressList = await ingressClient.listIngress({ roomName: room });
          ingresses = ingressList.map(i => ({
            id: i.ingressId,
            name: i.name,
            state: i.state,
            url: i.url,
            participantIdentity: i.participantIdentity,
            error: i.state?.error,
          }));
        } catch { /* ignore */ }
        try {
          const egressList = await egressClient.listEgress({ roomName: room });
          egresses = egressList.map(e => ({
            id: e.egressId,
            status: e.status,
            error: e.error,
          }));
        } catch { /* ignore */ }

        return NextResponse.json({
          room,
          isLive,
          currentDJ,
          participants: participants.map(p => ({
            identity: p.identity,
            name: p.name,
            tracks: p.tracks.map(t => ({
              sid: t.sid,
              type: t.type,
              muted: t.muted,
              source: t.source,
            })),
          })),
          ingresses,
          egresses,
        });
      }

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
        if (debug) {
          return NextResponse.json({ room, isLive: false, participants: [], ingresses: [], egresses: [], note: 'Room not found' });
        }
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
