import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { IngressClient, IngressInput } from 'livekit-server-sdk';
import { ROOM_NAME } from '@/types/broadcast';

const livekitHost = process.env.LIVEKIT_URL?.replace('wss://', 'https://') || '';
const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';

// POST - Start a restream by creating a URL ingress.
// The HLS egress is started later by the LiveKit webhook when the ingress
// participant publishes audio (see /api/livekit/webhook track_published handler).
export async function POST(request: NextRequest) {
  try {
    // Verify auth (cron secret or admin)
    const authHeader = request.headers.get('authorization');
    const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
    if (!hasValidSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { slotId } = await request.json();
    if (!slotId) {
      return NextResponse.json({ error: 'slotId required' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const slotDoc = await db.collection('broadcast-slots').doc(slotId).get();
    if (!slotDoc.exists) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
    }

    const slot = slotDoc.data()!;
    if (slot.broadcastType !== 'restream') {
      return NextResponse.json({ error: 'Not a restream slot' }, { status: 400 });
    }
    if (!slot.archiveRecordingUrl) {
      return NextResponse.json({ error: 'No archiveRecordingUrl on slot' }, { status: 400 });
    }

    if (!livekitHost || !apiKey || !apiSecret) {
      return NextResponse.json({ error: 'LiveKit not configured' }, { status: 500 });
    }

    // Create URL ingress — the participant will join the room and start publishing.
    // The LiveKit webhook (track_published) will then start the HLS egress.
    const ingressClient = new IngressClient(livekitHost, apiKey, apiSecret);
    const ingress = await ingressClient.createIngress(
      IngressInput.URL_INPUT,
      {
        name: `restream-${slotId}`,
        roomName: ROOM_NAME,
        participantIdentity: `restream-${slotId}`,
        participantName: slot.showName || 'Restream',
        url: slot.archiveRecordingUrl,
      }
    );
    console.log(`[start-restream] Ingress created: ${ingress.ingressId} (egress will start via webhook)`);

    // Set slot to live with ingress ID. Egress ID will be set by the webhook.
    await slotDoc.ref.update({
      status: 'live',
      restreamIngressId: ingress.ingressId,
    });

    return NextResponse.json({
      success: true,
      slotId,
      ingressId: ingress.ingressId,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[start-restream] Error:', error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
