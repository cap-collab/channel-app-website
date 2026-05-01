import { NextRequest, NextResponse } from 'next/server';
import { WebhookReceiver, EgressClient } from 'livekit-server-sdk';
import { SegmentedFileOutput, SegmentedFileProtocol, S3Upload } from '@livekit/protocol';
import { getAdminDb, getAdminRtdb } from '@/lib/firebase-admin';
import { Recording, STATION_ID, ROOM_NAME } from '@/types/broadcast';
import { extractDJs } from '@/lib/extract-djs';

// Generate URL-friendly slug from show name
function generateSlug(showName: string): string {
  return showName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';
const livekitHost = process.env.LIVEKIT_URL?.replace('wss://', 'https://') || '';

/** Write isStreaming status to Firebase RTDB so clients can subscribe in real time (no polling). */
async function updateStreamingStatus(isStreaming: boolean, djIdentity?: string) {
  try {
    const rtdb = getAdminRtdb();
    if (!rtdb) return;
    const statusRef = rtdb.ref('status/broadcast');
    await statusRef.set({
      isStreaming,
      dj: djIdentity || null,
      updatedAt: Date.now(),
    });
    console.log(`[webhook] RTDB isStreaming=${isStreaming} dj=${djIdentity || 'none'}`);
  } catch (err) {
    console.error('[webhook] Failed to update RTDB streaming status:', err);
  }
}
const r2PublicUrl = process.env.R2_PUBLIC_URL || '';

// R2 config for starting HLS egress on restream track_published
const r2AccountId = process.env.R2_ACCOUNT_ID || '';
const r2AccessKey = process.env.R2_ACCESS_KEY_ID || '';
const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2Bucket = process.env.R2_BUCKET_NAME || '';
const r2Endpoint = `https://${r2AccountId}.r2.cloudflarestorage.com`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const authHeader = request.headers.get('Authorization') || '';

    // Validate webhook signature
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    const event = await receiver.receive(body, authHeader);

    console.log('LiveKit webhook event:', event.event,
      event.participant ? `participant=${event.participant.identity}` : '',
      event.egressInfo?.egressId ? `egress=${event.egressInfo.egressId}` : '',
      event.ingressInfo?.ingressId ? `ingress=${event.ingressInfo.ingressId} state=${JSON.stringify(event.ingressInfo.state)}` : ''
    );

    // Handle track_published — start HLS egress when a restream ingress publishes audio.
    // This is triggered by the URL ingress created in /api/broadcast/start-restream.
    // We start the egress here (not in start-restream) because the ingress needs time
    // to join the room and publish; doing it in start-restream caused Vercel timeouts.
    if (event.event === 'track_published' && event.participant) {
      const identity = event.participant.identity;

      if (identity?.startsWith('restream-')) {
        const slotId = identity.replace('restream-', '');
        console.log(`[webhook] Restream participant ${identity} published track, starting egress for slot ${slotId}`);

        const db = getAdminDb();
        if (db && r2AccessKey && r2SecretKey) {
          const slotRef = db.collection('broadcast-slots').doc(slotId);
          const slotDoc = await slotRef.get();

          // Only start egress if slot exists and doesn't already have one
          if (slotDoc.exists && !slotDoc.data()?.restreamEgressId) {
            try {
              const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);

              // Stop any stale egresses first (from previous live broadcast)
              try {
                const existing = await egressClient.listEgress({ roomName: ROOM_NAME });
                for (const e of existing) {
                  if (e.status === 0 || e.status === 1) {
                    try {
                      await egressClient.stopEgress(e.egressId);
                      console.log(`[webhook] Stopped stale egress: ${e.egressId}`);
                    } catch { /* ignore */ }
                  }
                }
              } catch { /* ignore */ }

              // Start HLS egress now that ingress is publishing audio
              const s3Upload = new S3Upload({
                accessKey: r2AccessKey,
                secret: r2SecretKey,
                bucket: r2Bucket,
                region: 'auto',
                endpoint: r2Endpoint,
                forcePathStyle: true,
              });
              // Write to the same prefix as live. The listener's HLS url
              // is identical across live and restream, so live↔restream
              // transitions don't trigger a player reload.
              const segmentOutput = new SegmentedFileOutput({
                protocol: SegmentedFileProtocol.HLS_PROTOCOL,
                filenamePrefix: `${ROOM_NAME}/stream`,
                playlistName: 'playlist.m3u8',
                livePlaylistName: 'live.m3u8',
                segmentDuration: 6,
                output: { case: 's3', value: s3Upload },
              });
              const hlsEgress = await egressClient.startRoomCompositeEgress(
                ROOM_NAME,
                { segments: segmentOutput },
                { audioOnly: true }
              );

              await slotRef.update({ restreamEgressId: hlsEgress.egressId });
              console.log(`[webhook] HLS egress started for restream: ${hlsEgress.egressId}`);
            } catch (err) {
              console.error(`[webhook] Failed to start egress for restream ${slotId}:`, err);
            }
          }
        }
      }
    }

    // Update RTDB streaming status on track events (drives real-time isStreaming for clients).
    //
    // Guarding against stuck isStreaming=true:
    // 1. track_published → set true (straightforward)
    // 2. track_unpublished / participant_left → authoritative listParticipants check before clearing
    // 3. room_finished → unconditionally clear (room is gone, no one can be publishing)
    // 4. complete-expired-slots cron → also clears RTDB as a periodic safety net
    if (event.event === 'track_published' && event.participant && event.track) {
      if (event.track.type === 1 /* AUDIO */) {
        await updateStreamingStatus(true, event.participant.identity);
      }
    }

    if (
      event.event === 'track_unpublished' ||
      event.event === 'participant_left'
    ) {
      // Always do an authoritative room check -- event payload's room snapshot
      // may be stale and cannot be trusted for "is anyone still publishing?"
      try {
        const { RoomServiceClient } = await import('livekit-server-sdk');
        const roomService = new RoomServiceClient(livekitHost, apiKey, apiSecret);
        const participants = await roomService.listParticipants(ROOM_NAME);
        const publishing = participants.some(p =>
          p.tracks.some(t => t.type === 1 /* AUDIO */ && !t.muted)
        );
        if (!publishing) {
          await updateStreamingStatus(false);
        }
      } catch {
        // Room doesn't exist or LiveKit unreachable — no one is publishing
        await updateStreamingStatus(false);
      }
    }

    // Room fully closed — unconditionally clear streaming status.
    // This catches edge cases where track_unpublished/participant_left were missed.
    if (event.event === 'room_finished') {
      await updateStreamingStatus(false);
    }

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

        // Construct public URL from filename.
        // `originalRecordingUrl` stays pointing to the raw R2 upload.
        // `recordingUrl` may later be reassigned if auto-normalization produces a new version.
        const originalRecordingUrl = `${r2PublicUrl}/${mp4File.filename}`;
        let recordingUrl = originalRecordingUrl;

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
          // Check broadcast-slots first
          const legacySnapshot = await db.collection('broadcast-slots')
            .where('recordingEgressId', '==', egress.egressId)
            .limit(1)
            .get();
          if (!legacySnapshot.empty) {
            slotId = legacySnapshot.docs[0].id;
          } else {
            // Also check studio-sessions
            const studioSnapshot = await db.collection('studio-sessions')
              .where('recordingEgressId', '==', egress.egressId)
              .limit(1)
              .get();
            if (!studioSnapshot.empty) {
              slotId = studioSnapshot.docs[0].id;
            }
          }
        }

        if (slotId) {
          // Try broadcast-slots first, then studio-sessions
          let slotRef = db.collection('broadcast-slots').doc(slotId);
          let slotDoc = await slotRef.get();

          if (!slotDoc.exists) {
            slotRef = db.collection('studio-sessions').doc(slotId);
            slotDoc = await slotRef.get();
          }

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

            // Run faststart on the recording (moves moov atom to front for streaming)
            const restreamWorkerUrl = process.env.RESTREAM_WORKER_URL;
            const cronSecret = process.env.CRON_SECRET;
            try {
              if (restreamWorkerUrl && mp4File.filename) {
                const faststartRes = await fetch(`${restreamWorkerUrl}/faststart`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${cronSecret}`,
                  },
                  body: JSON.stringify({ r2Key: mp4File.filename }),
                });
                const faststartResult = await faststartRes.json();
                if (!faststartRes.ok) {
                  console.error(`[webhook] Faststart failed (${faststartRes.status}) for ${mp4File.filename}:`, faststartResult);
                } else {
                  console.log(`[webhook] Faststart done for ${mp4File.filename}:`, faststartResult);
                }
              } else {
                console.warn(`[webhook] Faststart skipped: RESTREAM_WORKER_URL=${restreamWorkerUrl ? 'set' : 'missing'}, filename=${mp4File.filename || 'missing'}`);
              }
            } catch (faststartError) {
              console.error('[webhook] Faststart error:', faststartError);
            }

            // Auto-normalize loudness for broken captures (quiet uniform recordings).
            // The worker decides internally whether to apply gain or skip — original R2
            // key is NEVER overwritten; a new "-normalized-v1.mp4" is uploaded instead.
            // Only updates Firestore recordingUrl if normalization was actually applied.
            try {
              if (restreamWorkerUrl && mp4File.filename) {
                const normRes = await fetch(`${restreamWorkerUrl}/normalize`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${cronSecret}`,
                  },
                  body: JSON.stringify({ r2Key: mp4File.filename }),
                });
                const normResult = await normRes.json();
                if (!normRes.ok) {
                  console.error(`[webhook] Normalize failed (${normRes.status}) for ${mp4File.filename}:`, normResult);
                } else if (normResult.skipped) {
                  console.log(`[webhook] Normalize skipped for ${mp4File.filename}: ${normResult.reason}`);
                } else if (normResult.newUrl) {
                  console.log(`[webhook] Normalize applied +${normResult.gainDb}dB for ${mp4File.filename} → ${normResult.newUrl}`);
                  // Swap effective URL to the normalized version — archive doc below
                  // will pick this up. Original stays as previousRecordingUrl for rollback.
                  recordingUrl = normResult.newUrl;
                  await slotRef.update({
                    previousRecordingUrl: originalRecordingUrl,
                    recordingUrl: normResult.newUrl,
                    normalizedAt: new Date(),
                    normalizedGainDb: normResult.gainDb,
                  });
                }
              }
            } catch (normError) {
              console.error('[webhook] Normalize error:', normError);
            }

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

              // Enrich DJs with genres, location, and bio from their profiles
              for (let i = 0; i < djs.length; i++) {
                const dj = djs[i];
                if (!dj.userId && !dj.username) continue;
                try {
                  let profileData: { genres?: string[]; location?: string; bio?: string } | null = null;
                  if (dj.userId) {
                    const userDoc = await db.collection('users').doc(dj.userId).get();
                    if (userDoc.exists) {
                      const profile = userDoc.data()?.djProfile;
                      profileData = { genres: profile?.genres, location: profile?.location, bio: profile?.bio };
                    }
                  }
                  if (!profileData && dj.username) {
                    const normalized = dj.username.replace(/[\s-]+/g, '').toLowerCase();
                    const snap = await db.collection('users')
                      .where('chatUsernameNormalized', '==', normalized)
                      .limit(1)
                      .get();
                    if (!snap.empty) {
                      const profile = snap.docs[0].data()?.djProfile;
                      profileData = { genres: profile?.genres, location: profile?.location, bio: profile?.bio };
                    }
                  }
                  if (profileData) {
                    if (profileData.genres?.length) djs[i] = { ...djs[i], genres: profileData.genres };
                    if (profileData.location) djs[i] = { ...djs[i], location: profileData.location };
                    if (profileData.bio) djs[i] = { ...djs[i], bio: profileData.bio };
                  }
                } catch (err) {
                  console.error(`Failed to enrich DJ ${dj.name} profile:`, err);
                }
              }

              // Get the recorded time from the slot's startTime
              const startTime = slotData?.startTime;
              const recordedAt = startTime?.toMillis ? startTime.toMillis() : Date.now();

              // Determine if this is a recording-only session (not a live broadcast)
              const isRecordingOnly = slotData?.broadcastType === 'recording';

              // For recording-only sessions, enrich DJs with email
              if (isRecordingOnly && slotData?.djEmail) {
                const djEmail = slotData.djEmail as string;
                if (djs.length > 0 && !djs[0].email) {
                  djs[0] = { ...djs[0], email: djEmail };
                }
              }

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
                priority: 'medium',
                // Both recordings and live broadcasts are public (auto-published)
                isPublic: true,
                sourceType: isRecordingOnly ? 'recording' : 'live',
                ...(isRecordingOnly ? {
                  uploadedBy: slotData?.djUserId as string,
                  publishedAt: Date.now(),
                } : {}),
              };

              // Include show image if available
              if (slotData?.showImageUrl) {
                archiveDoc.showImageUrl = slotData.showImageUrl;
              }

              await archivesRef.add(archiveDoc);

              console.log(`Archive created: ${slug} for show "${showName}" (${isRecordingOnly ? 'recording' : 'live'})`);

              // For recording-only mode, update the user's quota with actual duration
              if (isRecordingOnly && slotData?.djUserId) {
                try {
                  const userId = slotData.djUserId as string;
                  const userRef = db.collection('users').doc(userId);
                  const userDoc = await userRef.get();

                  if (userDoc.exists) {
                    const userData = userDoc.data();
                    const currentMonthKey = new Date().toISOString().slice(0, 7); // "2026-02"

                    let recordingQuota = userData?.recordingQuota || {
                      monthKey: currentMonthKey,
                      usedSeconds: 0,
                      maxSeconds: 7320, // 122 minutes default
                    };

                    // Reset if new month
                    if (recordingQuota.monthKey !== currentMonthKey) {
                      recordingQuota = {
                        monthKey: currentMonthKey,
                        usedSeconds: 0,
                        maxSeconds: recordingQuota.maxSeconds || 7320,
                      };
                    }

                    // Add actual duration to used seconds
                    recordingQuota.usedSeconds += durationSec;

                    await userRef.update({ recordingQuota });
                    console.log(`Updated recording quota for user ${userId}: ${recordingQuota.usedSeconds}s used`);
                  }
                } catch (quotaError) {
                  console.error('Failed to update recording quota:', quotaError);
                  // Don't fail the webhook if quota update fails
                }
              }
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
