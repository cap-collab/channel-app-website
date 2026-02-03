import { NextRequest, NextResponse } from 'next/server';
import { EgressClient } from 'livekit-server-sdk';
import { getAdminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

const livekitHost = process.env.LIVEKIT_URL?.replace('wss://', 'https://') || '';
const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';

/**
 * POST /api/recording/stop
 *
 * Stops a recording session - designed to work with sendBeacon for page unload.
 * Stops the egress and marks the slot as completed.
 */
export async function POST(request: NextRequest) {
  try {
    const { slotId, egressId } = await request.json();

    if (!slotId) {
      return NextResponse.json({ error: 'Slot ID required' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Stop egress if provided
    if (egressId) {
      try {
        const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);
        await egressClient.stopEgress(egressId);
        console.log('Stopped recording egress:', egressId);
      } catch (egressError) {
        // Log but don't fail - egress might already be stopped
        console.error('Failed to stop egress (may already be stopped):', egressError);
      }
    }

    // Mark the slot as completed
    const slotRef = db.collection('broadcast-slots').doc(slotId);
    const slotDoc = await slotRef.get();

    if (!slotDoc.exists) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
    }

    const slotData = slotDoc.data();

    // Only update if it's a recording slot that's still active
    if (slotData?.broadcastType === 'recording' && slotData?.status !== 'completed') {
      await slotRef.update({
        status: 'completed',
        completedAt: Timestamp.now(),
      });
      console.log('Marked recording slot as completed:', slotId);
    }

    return NextResponse.json({ success: true, slotId });

  } catch (error) {
    console.error('Recording stop error:', error);
    const message = error instanceof Error ? error.message : 'Failed to stop recording';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
