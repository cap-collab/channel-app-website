import { NextRequest, NextResponse } from 'next/server';
import { WebhookReceiver } from 'livekit-server-sdk';
import { getAdminDb } from '@/lib/firebase-admin';
import { Recording, ArchiveDJ, STATION_ID } from '@/types/broadcast';

// Generate URL-friendly slug from show name
function generateSlug(showName: string): string {
  return showName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Helper to remove undefined values from an object
function removeUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

// Extract DJ info from broadcast slot data
function extractDJs(slotData: Record<string, unknown>): ArchiveDJ[] {
  const djs: ArchiveDJ[] = [];

  // Check for venue broadcasts with djSlots
  if (slotData.djSlots && Array.isArray(slotData.djSlots)) {
    for (const slot of slotData.djSlots) {
      // Check for B3B (multiple DJs in one slot)
      if (slot.djProfiles && Array.isArray(slot.djProfiles)) {
        for (const profile of slot.djProfiles) {
          if (profile.username || profile.email || profile.userId) {
            djs.push(removeUndefined({
              name: profile.username || slot.djName || 'Unknown DJ',
              username: profile.username || undefined,
              userId: profile.userId || undefined,
              photoUrl: profile.photoUrl || undefined,
            }));
          }
        }
      } else if (slot.djName) {
        // Single DJ in this slot
        djs.push(removeUndefined({
          name: slot.djName,
          username: slot.djUsername || undefined,
          userId: slot.djUserId || slot.liveDjUserId || undefined,
          photoUrl: slot.djPhotoUrl || undefined,
        }));
      }
    }
  }

  // If no DJs found from djSlots, try top-level DJ info (remote broadcasts)
  if (djs.length === 0) {
    const djName = slotData.liveDjUsername || slotData.djName || slotData.djUsername;
    if (djName) {
      djs.push(removeUndefined({
        name: djName as string,
        username: (slotData.djUsername || slotData.liveDjUsername) as string | undefined,
        userId: (slotData.liveDjUserId || slotData.djUserId) as string | undefined,
        photoUrl: slotData.liveDjPhotoUrl as string | undefined,
      }));
    }
  }

  return djs;
}

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

            // Create archive for the recording
            try {
              const showName = (slotData?.showName as string) || 'Untitled Show';
              const baseSlug = generateSlug(showName);

              // Check for existing archives with same slug and find next available number
              const archivesRef = db.collection('archives');
              const existingArchives = await archivesRef
                .where('slug', '>=', baseSlug)
                .where('slug', '<=', baseSlug + '\uf8ff')
                .get();

              let slug = baseSlug;
              if (!existingArchives.empty) {
                // Find the highest numbered slug
                let maxNumber = 0;
                existingArchives.docs.forEach(doc => {
                  const existingSlug = doc.data().slug;
                  if (existingSlug === baseSlug) {
                    maxNumber = Math.max(maxNumber, 1);
                  } else {
                    const match = existingSlug.match(new RegExp(`^${baseSlug}-(\\d+)$`));
                    if (match) {
                      maxNumber = Math.max(maxNumber, parseInt(match[1], 10));
                    }
                  }
                });
                if (maxNumber > 0) {
                  slug = `${baseSlug}-${maxNumber + 1}`;
                }
              }

              // Extract DJ info from the slot
              const djs = extractDJs(slotData || {});

              // Get the recorded time from the slot's startTime
              const startTime = slotData?.startTime;
              const recordedAt = startTime?.toMillis ? startTime.toMillis() : Date.now();

              // Create the archive document
              const archiveDoc: Record<string, unknown> = {
                slug,
                broadcastSlotId: slotId,
                showName,
                djs,
                recordingUrl,
                duration: durationSec,
                recordedAt,
                createdAt: Date.now(),
                stationId: (slotData?.stationId as string) || STATION_ID,
              };

              // Include show image if available
              if (slotData?.showImageUrl) {
                archiveDoc.showImageUrl = slotData.showImageUrl;
              }

              await archivesRef.add(archiveDoc);

              console.log(`Archive created: ${slug} for show "${showName}"`);
            } catch (archiveError) {
              console.error('Failed to create archive:', archiveError);
              // Don't fail the webhook if archive creation fails
            }

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
