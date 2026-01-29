import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { getAllShows } from '@/lib/metadata';
import { getStationByMetadataKey } from '@/lib/stations';
import { Timestamp } from 'firebase-admin/firestore';

// Verify request is from Vercel Cron
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// Normalize name for DJ profile lookup (matches sync-auto-dj-profiles)
function normalizeForProfileLookup(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// This cron job runs every hour at :05 to archive external shows that have ended
// Most shows end at :00, so running at :05 ensures we capture them
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const now = Date.now();
    let archivedCount = 0;
    let skippedCount = 0;
    let processedCount = 0;

    // Fetch all shows from metadata
    const allShows = await getAllShows();

    // Filter for external shows that have ended
    const endedExternalShows = allShows.filter(show =>
      show.stationId !== "broadcast" &&
      show.stationId !== "newtown" && // Skip Newtown as it doesn't have reliable DJ data
      new Date(show.endTime).getTime() < now
    );

    processedCount = endedExternalShows.length;

    // Build a map of normalized names to DJ usernames from pending-dj-profiles
    const pendingProfilesSnapshot = await db.collection('pending-dj-profiles').get();
    const djUsernameMap = new Map<string, string>();

    pendingProfilesSnapshot.forEach(doc => {
      const data = doc.data();
      const normalizedUsername = data.chatUsernameNormalized || normalizeForProfileLookup(data.chatUsername || '');
      if (normalizedUsername) {
        djUsernameMap.set(normalizedUsername, normalizedUsername);
      }
    });

    // Also get usernames from users collection for DJs
    const usersSnapshot = await db
      .collection('users')
      .where('role', 'in', ['dj', 'broadcaster', 'admin'])
      .get();

    usersSnapshot.forEach(doc => {
      const data = doc.data();
      const normalizedUsername = data.chatUsernameNormalized || normalizeForProfileLookup(data.chatUsername || '');
      if (normalizedUsername) {
        djUsernameMap.set(normalizedUsername, normalizedUsername);
      }
    });

    // Archive each show
    const pastExternalShowsRef = db.collection('past-external-shows');

    for (const show of endedExternalShows) {
      // Generate document ID based on station and start time for deduplication
      const docId = `${show.stationId}-${show.startTime}`;

      // Check if already archived
      const existingDoc = await pastExternalShowsRef.doc(docId).get();
      if (existingDoc.exists) {
        skippedCount++;
        continue;
      }

      // Get station info (stationId from shows is the metadata key, e.g., "nts1")
      const station = getStationByMetadataKey(show.stationId);

      // Try to find DJ username from show.dj or show.name
      let djUsername: string | undefined;
      const candidateNames = [
        show.dj,
        show.name,
        // Handle "Show Name - DJ Name" pattern
        show.name.includes(' - ') ? show.name.split(' - ')[1]?.trim() : undefined,
        show.name.includes(' - ') ? show.name.split(' - ')[0]?.trim() : undefined,
      ].filter(Boolean) as string[];

      for (const candidate of candidateNames) {
        const normalized = normalizeForProfileLookup(candidate);
        if (djUsernameMap.has(normalized)) {
          djUsername = djUsernameMap.get(normalized);
          break;
        }
      }

      // Create the archive document (only include defined values)
      const docData: Record<string, unknown> = {
        stationId: show.stationId,
        stationName: station?.name || show.stationId,
        showName: show.name,
        startTime: Timestamp.fromDate(new Date(show.startTime)),
        endTime: Timestamp.fromDate(new Date(show.endTime)),
        archivedAt: Timestamp.now(),
      };
      if (show.dj) docData.dj = show.dj;
      if (djUsername) docData.djUsername = djUsername;

      await pastExternalShowsRef.doc(docId).set(docData);

      archivedCount++;
    }

    console.log(`[archive-external-shows] Processed ${processedCount} shows, archived ${archivedCount}, skipped ${skippedCount}`);

    return NextResponse.json({
      success: true,
      processed: processedCount,
      archived: archivedCount,
      skipped: skippedCount,
    });
  } catch (error) {
    console.error('Error in archive-external-shows cron:', error);
    return NextResponse.json({
      error: 'Failed to archive shows',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
