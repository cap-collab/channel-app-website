import { NextRequest, NextResponse } from 'next/server';
import { WebhookReceiver } from 'livekit-server-sdk';
import { getAdminDb } from '@/lib/firebase-admin';

const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';
const r2PublicUrl = process.env.R2_PUBLIC_URL || '';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const authHeader = request.headers.get('Authorization') || '';

    // Validate webhook signature
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    const event = await receiver.receive(body, authHeader);

    console.log('LiveKit webhook event:', event.event, event.egressInfo?.egressId);

    // Handle egress ended events - save recording URL to Firestore
    if (event.event === 'egress_ended' && event.egressInfo) {
      const egress = event.egressInfo;
      const fileResults = egress.fileResults || [];

      // Find MP4 file result
      const mp4File = fileResults.find(f => f.filename?.endsWith('.mp4'));

      if (mp4File && mp4File.filename) {
        const db = getAdminDb();
        if (!db) {
          console.error('Firebase Admin not configured');
          return NextResponse.json({ received: true, warning: 'DB not configured' });
        }

        // Find the slot with this recording egress ID
        const slotsRef = db.collection('broadcast-slots');
        const snapshot = await slotsRef
          .where('recordingEgressId', '==', egress.egressId)
          .limit(1)
          .get();

        if (!snapshot.empty) {
          const slotDoc = snapshot.docs[0];

          // Construct public URL from filename
          const recordingUrl = `${r2PublicUrl}/${mp4File.filename}`;

          // Duration is in nanoseconds, convert to seconds
          const durationNs = mp4File.duration ? Number(mp4File.duration) : 0;
          const durationSec = Math.round(durationNs / 1_000_000_000);

          await slotDoc.ref.update({
            recordingUrl,
            recordingStatus: 'ready',
            recordingDuration: durationSec,
          });

          console.log(`Recording saved for slot ${slotDoc.id}: ${recordingUrl} (${durationSec}s)`);
        } else {
          console.log('No slot found for egress:', egress.egressId);
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    // Return 200 to acknowledge receipt even on error (prevents retries)
    return NextResponse.json({ received: true, error: 'Processing failed' });
  }
}
