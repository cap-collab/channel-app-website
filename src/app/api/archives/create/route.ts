import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { ArchiveDJ, STATION_ID } from '@/types/broadcast';

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
              email: profile.email || undefined,
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
          email: slot.djEmail || undefined,
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
        email: slotData.djEmail as string | undefined,
      }));
    }
  }

  return djs;
}

export async function POST(request: NextRequest) {
  try {
    const { showName } = await request.json();

    if (!showName) {
      return NextResponse.json({ error: 'showName is required' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Find the broadcast slot by show name (simple query without orderBy to avoid index requirement)
    const slotsRef = db.collection('broadcast-slots');
    const snapshot = await slotsRef
      .where('showName', '==', showName)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: `No broadcast slot found for show: ${showName}` }, { status: 404 });
    }

    // Sort by startTime manually to get the most recent
    const sortedDocs = snapshot.docs.sort((a, b) => {
      const aTime = a.data().startTime?.toMillis?.() || 0;
      const bTime = b.data().startTime?.toMillis?.() || 0;
      return bTime - aTime;
    });

    const slotDoc = sortedDocs[0];
    const slotData = slotDoc.data();
    const slotId = slotDoc.id;

    // Check if there's a recording
    let recordingUrl: string | undefined;
    let duration = 0;

    // Check recordings array first
    if (slotData.recordings && Array.isArray(slotData.recordings)) {
      const readyRecording = slotData.recordings.find((r: { status: string; url?: string }) => r.status === 'ready' && r.url);
      if (readyRecording) {
        recordingUrl = readyRecording.url;
        duration = readyRecording.duration || 0;
      }
    }

    // Fallback to legacy fields
    if (!recordingUrl && slotData.recordingUrl && slotData.recordingStatus === 'ready') {
      recordingUrl = slotData.recordingUrl;
      duration = slotData.recordingDuration || 0;
    }

    if (!recordingUrl) {
      return NextResponse.json({
        error: 'No ready recording found for this show',
        slot: { id: slotId, showName: slotData.showName, status: slotData.status, recordingStatus: slotData.recordingStatus }
      }, { status: 400 });
    }

    // Generate slug
    const baseSlug = generateSlug(showName);
    const archivesRef = db.collection('archives');

    // Check for existing archives with same slug
    const existingArchives = await archivesRef
      .where('slug', '>=', baseSlug)
      .where('slug', '<=', baseSlug + '\uf8ff')
      .get();

    let slug = baseSlug;
    if (!existingArchives.empty) {
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

    // Extract DJ info
    const djs = extractDJs(slotData);

    // Get recorded time from slot's startTime
    const startTime = slotData.startTime;
    const recordedAt = startTime?.toMillis ? startTime.toMillis() : Date.now();

    // Create the archive
    const archiveRef = await archivesRef.add({
      slug,
      broadcastSlotId: slotId,
      showName,
      djs,
      recordingUrl,
      duration,
      recordedAt,
      createdAt: Date.now(),
      stationId: slotData.stationId || STATION_ID,
    });

    return NextResponse.json({
      success: true,
      archive: {
        id: archiveRef.id,
        slug,
        showName,
        djs,
        recordingUrl,
        duration,
      }
    });
  } catch (error) {
    console.error('Error creating archive:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to create archive', details: errorMessage }, { status: 500 });
  }
}
