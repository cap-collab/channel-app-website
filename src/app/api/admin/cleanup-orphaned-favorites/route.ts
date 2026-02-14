import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

const METADATA_URL = "https://cap-collab.github.io/channel-metadata/metadata.json";

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

interface ShowV2 {
  n: string; // name
  s: string; // start
  e: string; // end
  j?: string | null; // dj
  t?: string | null; // type
  [key: string]: unknown;
}

interface MetadataResponse {
  stations: Record<string, ShowV2[]>;
}

interface OrphanedFavorite {
  userId: string;
  favoriteId: string;
  term: string;
  showName?: string;
  stationId?: string;
  type: string;
}

/**
 * Build the set of valid show keys from metadata + broadcast slots.
 * Returns a Set of "term-stationId" keys.
 */
async function buildValidShowsSet(db: FirebaseFirestore.Firestore): Promise<Set<string>> {
  const validShows = new Set<string>();

  // 1. Fetch metadata (all external station shows)
  try {
    const response = await fetch(METADATA_URL);
    if (response.ok) {
      const metadata: MetadataResponse = await response.json();

      // Map metadata station keys to station IDs (same as expandShow in metadata.ts)
      const { getStationByMetadataKey } = await import('@/lib/stations');

      for (const [stationKey, shows] of Object.entries(metadata.stations)) {
        const station = getStationByMetadataKey(stationKey);
        const stationId = station?.id || stationKey;

        for (const show of shows) {
          const key = `${show.n.toLowerCase()}-${stationId}`;
          validShows.add(key);
        }
      }
      console.log(`[cleanup] Loaded ${validShows.size} shows from metadata`);
    }
  } catch (error) {
    console.error("[cleanup] Failed to fetch metadata:", error);
  }

  // 2. Fetch broadcast slots (active/future)
  try {
    const now = new Date();
    const pastCutoff = new Date(now);
    pastCutoff.setDate(pastCutoff.getDate() - 7); // Include recent past shows

    const snapshot = await db.collection('broadcast-slots')
      .where('startTime', '>=', Timestamp.fromDate(pastCutoff))
      .get();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.status === 'cancelled') continue;

      const showName = (data.showName as string || '').toLowerCase();
      const stationId = (data.stationId as string) || 'broadcast';
      validShows.add(`${showName}-${stationId}`);
    }
    console.log(`[cleanup] Total valid shows after broadcast slots: ${validShows.size}`);
  } catch (error) {
    console.error("[cleanup] Failed to fetch broadcast slots:", error);
  }

  return validShows;
}

/**
 * Find all orphaned show-type favorites.
 */
async function findOrphanedFavorites(
  db: FirebaseFirestore.Firestore,
  validShows: Set<string>
): Promise<OrphanedFavorite[]> {
  const orphaned: OrphanedFavorite[] = [];

  // Get ALL show-type favorites across all users
  const snapshot = await db.collectionGroup('favorites')
    .where('type', '==', 'show')
    .get();

  console.log(`[cleanup] Found ${snapshot.size} total show-type favorites`);

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const term = (data.term as string || '').toLowerCase();
    const stationId = (data.stationId as string) || '';
    const key = `${term}-${stationId}`;

    if (!validShows.has(key)) {
      // Extract userId from doc path: users/{userId}/favorites/{favId}
      const pathParts = doc.ref.path.split('/');
      const userId = pathParts[1];

      orphaned.push({
        userId,
        favoriteId: doc.id,
        term,
        showName: data.showName as string | undefined,
        stationId,
        type: 'show',
      });
    }
  }

  return orphaned;
}

/**
 * Find orphaned IRL favorites (past events).
 */
async function findOrphanedIRLFavorites(
  db: FirebaseFirestore.Firestore
): Promise<OrphanedFavorite[]> {
  const orphaned: OrphanedFavorite[] = [];
  const today = new Date().toISOString().split("T")[0];

  const snapshot = await db.collectionGroup('favorites')
    .where('type', '==', 'irl')
    .get();

  console.log(`[cleanup] Found ${snapshot.size} total IRL favorites`);

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const irlDate = data.irlDate as string | undefined;

    // Only clean up IRL events that are in the past
    if (irlDate && irlDate < today) {
      const pathParts = doc.ref.path.split('/');
      const userId = pathParts[1];

      orphaned.push({
        userId,
        favoriteId: doc.id,
        term: data.term as string || '',
        showName: data.irlEventName as string | undefined,
        stationId: undefined,
        type: 'irl',
      });
    }
  }

  return orphaned;
}

// GET - Dry run (report what would be deleted)
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    const validShows = await buildValidShowsSet(db);
    const orphanedShows = await findOrphanedFavorites(db, validShows);
    const orphanedIRL = await findOrphanedIRLFavorites(db);

    return NextResponse.json({
      dryRun: true,
      validShowsCount: validShows.size,
      orphanedShows: {
        count: orphanedShows.length,
        items: orphanedShows,
      },
      orphanedIRL: {
        count: orphanedIRL.length,
        items: orphanedIRL,
      },
      message: "Use POST to delete these orphaned favorites",
    });
  } catch (error) {
    console.error("[cleanup] Error:", error);
    return NextResponse.json({ error: 'Cleanup failed', details: String(error) }, { status: 500 });
  }
}

// POST - Execute deletions
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    const validShows = await buildValidShowsSet(db);
    const orphanedShows = await findOrphanedFavorites(db, validShows);
    const orphanedIRL = await findOrphanedIRLFavorites(db);

    const allOrphaned = [...orphanedShows, ...orphanedIRL];

    if (allOrphaned.length === 0) {
      return NextResponse.json({
        success: true,
        deleted: 0,
        message: "No orphaned favorites found",
      });
    }

    // Batch delete
    let deleteCount = 0;
    let batch = db.batch();

    for (const orphan of allOrphaned) {
      const ref = db.doc(`users/${orphan.userId}/favorites/${orphan.favoriteId}`);
      batch.delete(ref);
      deleteCount++;

      if (deleteCount % 500 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }

    if (deleteCount % 500 !== 0) {
      await batch.commit();
    }

    console.log(`[cleanup] Deleted ${deleteCount} orphaned favorites (${orphanedShows.length} shows, ${orphanedIRL.length} IRL)`);

    return NextResponse.json({
      success: true,
      deleted: deleteCount,
      showsDeleted: orphanedShows.length,
      irlDeleted: orphanedIRL.length,
      items: allOrphaned,
    });
  } catch (error) {
    console.error("[cleanup] Error:", error);
    return NextResponse.json({ error: 'Cleanup failed', details: String(error) }, { status: 500 });
  }
}
