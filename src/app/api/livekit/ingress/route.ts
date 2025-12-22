import { IngressClient, IngressInput } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { ROOM_NAME, IngressInfo } from '@/types/broadcast';

const livekitHost = process.env.LIVEKIT_URL?.replace('wss://', 'https://') || '';
const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';

// Map LiveKit ingress state status to our status type
// IngressState_Status: 0 = ENDPOINT_INACTIVE, 1 = ENDPOINT_BUFFERING, 2 = ENDPOINT_PUBLISHING, 3 = ENDPOINT_ERROR
function mapIngressStatus(stateStatus: number | undefined): IngressInfo['status'] {
  switch (stateStatus) {
    case 0: return 'inactive';
    case 1: return 'buffering';
    case 2: return 'publishing';
    case 3: return 'error';
    default: return 'inactive';
  }
}

// POST - Create RTMP ingress for a DJ
export async function POST(request: NextRequest) {
  try {
    if (!livekitHost || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'LiveKit not configured' },
        { status: 500 }
      );
    }

    const { participantIdentity, participantName } = await request.json();

    if (!participantIdentity) {
      return NextResponse.json(
        { error: 'participantIdentity is required' },
        { status: 400 }
      );
    }

    const ingressClient = new IngressClient(livekitHost, apiKey, apiSecret);

    // Create RTMP ingress with default audio settings
    const ingress = await ingressClient.createIngress(
      IngressInput.RTMP_INPUT,
      {
        name: `dj-ingress-${participantIdentity}`,
        roomName: ROOM_NAME,
        participantIdentity,
        participantName: participantName || participantIdentity,
        // Using default audio encoding settings
      }
    );

    const response: IngressInfo = {
      ingressId: ingress.ingressId,
      url: ingress.url,
      streamKey: ingress.streamKey,
      status: mapIngressStatus(ingress.state?.status),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error creating ingress:', error);
    const message = error instanceof Error ? error.message : 'Failed to create ingress';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET - Get ingress status
export async function GET(request: NextRequest) {
  try {
    if (!livekitHost || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'LiveKit not configured' },
        { status: 500 }
      );
    }

    const ingressId = request.nextUrl.searchParams.get('ingressId');

    const ingressClient = new IngressClient(livekitHost, apiKey, apiSecret);

    if (ingressId) {
      // Get specific ingress
      const ingresses = await ingressClient.listIngress({ roomName: ROOM_NAME });
      const ingress = ingresses.find(i => i.ingressId === ingressId);

      if (!ingress) {
        return NextResponse.json({ error: 'Ingress not found' }, { status: 404 });
      }

      const response: IngressInfo = {
        ingressId: ingress.ingressId,
        url: ingress.url,
        streamKey: ingress.streamKey,
        status: mapIngressStatus(ingress.state?.status),
      };

      return NextResponse.json(response);
    } else {
      // List all ingresses for the room
      const ingresses = await ingressClient.listIngress({ roomName: ROOM_NAME });

      const response = ingresses.map(ingress => ({
        ingressId: ingress.ingressId,
        url: ingress.url,
        streamKey: ingress.streamKey,
        status: mapIngressStatus(ingress.state?.status),
        participantIdentity: ingress.participantIdentity,
      }));

      return NextResponse.json({ ingresses: response });
    }
  } catch (error) {
    console.error('Error getting ingress:', error);
    const message = error instanceof Error ? error.message : 'Failed to get ingress';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE - Delete an ingress
export async function DELETE(request: NextRequest) {
  try {
    if (!livekitHost || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'LiveKit not configured' },
        { status: 500 }
      );
    }

    const { ingressId } = await request.json();

    if (!ingressId) {
      return NextResponse.json({ error: 'ingressId is required' }, { status: 400 });
    }

    const ingressClient = new IngressClient(livekitHost, apiKey, apiSecret);
    await ingressClient.deleteIngress(ingressId);

    return NextResponse.json({ success: true, ingressId });
  } catch (error) {
    console.error('Error deleting ingress:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete ingress';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
