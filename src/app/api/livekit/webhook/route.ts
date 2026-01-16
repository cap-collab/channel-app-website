import { NextRequest, NextResponse } from 'next/server';
import { WebhookReceiver } from 'livekit-server-sdk';
import { getAdminDb } from '@/lib/firebase-admin';
import { Recording } from '@/types/broadcast';

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

        // Construct public URL from filename
        const recordingUrl = `${r2PublicUrl}/${mp4File.filename}`;

        // Duration is in nanoseconds, convert to seconds
        const durationNs = mp4File.duration ? Number(mp4File.duration) : 0;
        const durationSec = Math.round(durationNs / 1_000_000_000);

        // Find the slot using the egress-to-slot mapping (supports multiple recordings)
        let slotId: string | null = null;
        const mappingDoc = await db.collection('recording-egress-map').doc(egress.egressId).get();
        if (mappingDoc.exists) {
          slotId = mappingDoc.data()?.slotId;
        }

        // Fallback: try legacy recordingEgressId field for backward compatibility
        if (!slotId) {
          const slotsRef = db.collection('broadcast-slots');
          const legacySnapshot = await slotsRef
            .where('recordingEgressId', '==', egress.egressId)
            .limit(1)
            .get();
          if (!legacySnapshot.empty) {
            slotId = legacySnapshot.docs[0].id;
          }
        }

        if (slotId) {
          const slotRef = db.collection('broadcast-slots').doc(slotId);
          const slotDoc = await slotRef.get();

          if (slotDoc.exists) {
            const slotData = slotDoc.data();
            const recordings: Recording[] = slotData?.recordings || [];

            // Find and update the specific recording in the array
            const updatedRecordings = recordings.map((rec: Recording) => {
              if (rec.egressId === egress.egressId) {
                return {
                  ...rec,
                  url: recordingUrl,
                  status: 'ready' as const,
                  duration: durationSec,
                  endedAt: Date.now(),
                };
              }
              return rec;
            });

            // Update the slot with the updated recordings array
            // Also update legacy fields if this matches the current recordingEgressId
            const updateData: Record<string, unknown> = {
              recordings: updatedRecordings,
            };

            if (slotData?.recordingEgressId === egress.egressId) {
              updateData.recordingUrl = recordingUrl;
              updateData.recordingStatus = 'ready';
              updateData.recordingDuration = durationSec;
            }

            await slotRef.update(updateData);
            console.log(`Recording saved for slot ${slotId}: ${recordingUrl} (${durationSec}s)`);

            // Clean up the mapping document
            try {
              await db.collection('recording-egress-map').doc(egress.egressId).delete();
            } catch (cleanupError) {
              console.error('Failed to clean up egress mapping:', cleanupError);
            }
          }
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
