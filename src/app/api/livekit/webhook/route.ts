import { NextRequest, NextResponse } from 'next/server';
import { WebhookReceiver, EgressClient } from 'livekit-server-sdk';
import { SegmentedFileOutput, SegmentedFileProtocol, S3Upload } from '@livekit/protocol';
import { getAdminDb, getAdminRtdb } from '@/lib/firebase-admin';
import { Recording, STATION_ID, ROOM_NAME } from '@/types/broadcast';
import { extractDJs } from '@/lib/extract-djs';
import { resolveSceneSlugsForArchive } from '@/lib/archive-scene-resolve';
import { copyCollectiveChatToOwners } from '@/lib/copy-collective-chat';
import { normalizeUsername } from '@/lib/dj-matching';

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
          } else if (slotDoc.exists) {
            // Attribution log: webhook arrived but skipped because the slot already
            // has an egress id (set by start-restream's inline path). Confirms the
            // track_published webhook is landing, not being dropped.
            console.log(`[webhook] Restream ${slotId} already has egress ${slotDoc.data()?.restreamEgressId} — skipping (track_published landed OK)`);
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
      // Attribution log: how long this handler takes matters — a slow egress_ended
      // (it used to do an inline blocking faststart fetch) stalls LiveKit's
      // serialized webhook sender and starves the next boundary's track_published.
      // Faststart is now deferred to a queue, so this should return fast.
      const ee_t0 = Date.now();
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

        // Construct public URL from filename. The post-broadcast normalize
        // pipeline runs asynchronously through the normalize-queue (see
        // /api/cron/drain-normalize-queue), so `recordingUrl` here always
        // points at the raw upload. The drain endpoint swaps slot + archive
        // doc URLs to v2 once normalization completes.
        const originalRecordingUrl = `${r2PublicUrl}/${mp4File.filename}`;
        const recordingUrl = originalRecordingUrl;

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

            // Enqueue faststart (moves moov atom to front) instead of running it
            // inline. The inline `await fetch(.../faststart)` used to download +
            // rewrite the whole MP4 here (seconds→minutes for long sets) BEFORE
            // returning 200 — and LiveKit's webhook sender is serialized, so it
            // starved the next slot boundary's track_published (which starts the
            // restream egress) → silent restream transitions. Deferring it keeps
            // egress_ended fast. The drain cron (/api/cron/drain-faststart-queue)
            // runs faststart in a quiet window, then enqueues normalize (which
            // must run AFTER faststart). See faststart-queue collection.
            try {
              if (mp4File.filename) {
                await db.collection('faststart-queue').add({
                  r2Key: mp4File.filename,
                  slotId,
                  queuedAt: Date.now(),
                  status: 'pending',
                  attempts: 0,
                });
                console.log(`[webhook] Faststart queued for ${mp4File.filename}`);
              }
            } catch (queueError) {
              console.error('[webhook] Faststart enqueue error:', queueError);
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
                priority: isRecordingOnly ? 'low' : 'medium',
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

              // Carry the resolved Opus RED decision from the slot, if recorded.
              if (typeof slotData?.redMode === 'string') {
                archiveDoc.redMode = slotData.redMode;
              }

              // Scene: slot override, else inherit the DJs' profile scenes so the
              // archive always carries sceneSlugs (additive — no existing field touched).
              try {
                const sceneSlugs = Array.isArray(slotData?.sceneIdsOverride) && slotData.sceneIdsOverride.length > 0
                  ? (slotData.sceneIdsOverride as string[])
                  : await resolveSceneSlugsForArchive(db, djs);
                if (sceneSlugs.length > 0) archiveDoc.sceneSlugs = sceneSlugs;
              } catch (e) {
                console.error('[webhook] scene resolve failed (non-fatal):', e);
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

            // LAST: collective broadcasts → fan out chat to each owner's per-DJ
            // room. Purely cosmetic. Runs after every other webhook step so it
            // can't compete for compute or block anything; wrapped + caught so
            // a failure here is a no-op for the rest of the system. No-op when
            // the slot's djUsername doesn't resolve to a collective.
            if (slotData?.broadcastType !== 'recording') {
              // Canonicalize to the same key the live chat wrote to AND the
              // collective slug — strips dots so "B. Rod b2b David L" →
              // "brodb2bdavidl" (see computeDJChatRoom / normalizeUsername).
              // Without this, a dotted collective name read the wrong chat
              // room and copied nothing to owners.
              const rawCandidate = (slotData?.djUsername || slotData?.liveDjUsername) as string | undefined;
              const candidateSlug = rawCandidate ? normalizeUsername(rawCandidate) : undefined;
              const startTimeForChat = slotData?.startTime;
              const recordedAtMs: number = startTimeForChat?.toMillis ? startTimeForChat.toMillis() : Date.now();
              if (candidateSlug) {
                try {
                  const result = await copyCollectiveChatToOwners(db, {
                    collectiveSlug: candidateSlug,
                    windowStartMs: recordedAtMs,
                    windowEndMs: recordedAtMs + durationSec * 1000,
                  });
                  if (result.writes > 0) {
                    console.log(`[webhook] Collective chat fan-out: ${result.writes} writes into ${result.ownerRooms.length} owner rooms (${result.ownerRooms.join(', ')})`);
                  }
                } catch (copyErr) {
                  console.error('[webhook] Collective chat fan-out failed (non-fatal):', copyErr);
                }
              }
            }
          }
        } else {
          console.log('No slot found for egress:', egress.egressId);
        }
      }
      // Attribution log: total egress_ended handler duration. Should be small now
      // that faststart is queued (not awaited). A large value here = something
      // else inline is still stalling LiveKit's serialized webhook queue.
      console.log(`[webhook] egress_ended handled in ${Date.now() - ee_t0}ms (egress=${egress.egressId})`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    // Return 200 to acknowledge receipt even on error (prevents retries)
    return NextResponse.json({ received: true, error: 'Processing failed' });
  }
}
