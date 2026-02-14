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
  reason: string;
}

interface DJProfileData {
  chatUsername?: string;
  irlShows?: Array<{ name: string; date: string; location: string; url: string }>;
  radioShows?: Array<{ name: string; radioName: string; date: string; time: string; duration: string; url: string }>;
}

/**
 * Fetch all users once and extract DJ profile data for validation.
 */
async function fetchDJProfiles(db: FirebaseFirestore.Firestore): Promise<{
  validIRL: Set<string>;
  validDJRadio: Set<string>;
}> {
  const validIRL = new Set<string>();
  const validDJRadio = new Set<string>();

  const usersSnapshot = await db.collection('users').get();
  console.log(`[cleanup] Fetched ${usersSnapshot.size} users`);

  for (const userDoc of usersSnapshot.docs) {
    const data = userDoc.data();
    const djProfile = data.djProfile as DJProfileData | undefined;
    if (!djProfile?.chatUsername) continue;

    // IRL shows: key = irl-{username}-{date}-{location}
    if (djProfile.irlShows) {
      for (const show of djProfile.irlShows) {
        if (!show.name && !show.date && !show.location) continue;
        const key = `irl-${djProfile.chatUsername}-${show.date}-${show.location}`.toLowerCase();
        validIRL.add(key);
      }
    }

    // Radio shows: key = {name}-{radioName}-{date}
    if (djProfile.radioShows) {
      for (const show of djProfile.radioShows) {
        if (!show.name && !show.date && !show.radioName) continue;
        const key = `${show.name}-${show.radioName}-${show.date}`.toLowerCase();
        validDJRadio.add(key);
      }
    }
  }

  console.log(`[cleanup] Valid IRL shows from DJ profiles: ${validIRL.size}`);
  console.log(`[cleanup] Valid DJ radio shows from DJ profiles: ${validDJRadio.size}`);

  return { validIRL, validDJRadio };
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
    pastCutoff.setDate(pastCutoff.getDate() - 7);

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
 * Find all orphaned favorites across all types.
 */
async function findAllOrphaned(
  db: FirebaseFirestore.Firestore,
  validShows: Set<string>,
  validIRL: Set<string>,
  validDJRadio: Set<string>,
): Promise<OrphanedFavorite[]> {
  const orphaned: OrphanedFavorite[] = [];

  // 1. Check show-type favorites
  const showSnapshot = await db.collectionGroup('favorites')
    .where('type', '==', 'show')
    .get();

  console.log(`[cleanup] Found ${showSnapshot.size} total show-type favorites`);

  for (const doc of showSnapshot.docs) {
    const data = doc.data();
    const term = (data.term as string || '').toLowerCase();
    const stationId = (data.stationId as string) || '';
    const metadataKey = `${term}-${stationId}`;
    const pathParts = doc.ref.path.split('/');
    const userId = pathParts[1];

    if (data.createdBy === 'system' && data.djUsername) {
      // DJ-synced radio show — check against DJ profiles
      if (term && !validDJRadio.has(term)) {
        orphaned.push({
          userId,
          favoriteId: doc.id,
          term,
          showName: data.showName as string | undefined,
          stationId,
          type: 'show',
          reason: `DJ-synced radio show no longer in DJ profile`,
        });
      }
    } else {
      // User-added or metadata-based show — check against metadata + broadcast slots
      if (!validShows.has(metadataKey)) {
        orphaned.push({
          userId,
          favoriteId: doc.id,
          term,
          showName: data.showName as string | undefined,
          stationId,
          type: 'show',
          reason: `Show not found in metadata or broadcast slots`,
        });
      }
    }
  }

  // 2. Check IRL favorites — against DJ profiles
  const irlSnapshot = await db.collectionGroup('favorites')
    .where('type', '==', 'irl')
    .get();

  console.log(`[cleanup] Found ${irlSnapshot.size} total IRL favorites`);

  for (const doc of irlSnapshot.docs) {
    const data = doc.data();
    const term = (data.term as string || '').toLowerCase();

    if (term && !validIRL.has(term)) {
      const pathParts = doc.ref.path.split('/');
      const userId = pathParts[1];

      orphaned.push({
        userId,
        favoriteId: doc.id,
        term,
        showName: data.irlEventName as string | undefined,
        stationId: undefined,
        type: 'irl',
        reason: `IRL show no longer in DJ profile`,
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
    const [validShows, djData] = await Promise.all([
      buildValidShowsSet(db),
      fetchDJProfiles(db),
    ]);

    const orphaned = await findAllOrphaned(db, validShows, djData.validIRL, djData.validDJRadio);

    const orphanedShows = orphaned.filter(o => o.type === 'show');
    const orphanedIRL = orphaned.filter(o => o.type === 'irl');

    return NextResponse.json({
      dryRun: true,
      validShowsCount: validShows.size,
      validIRLCount: djData.validIRL.size,
      validDJRadioCount: djData.validDJRadio.size,
      orphanedShows: {
        count: orphanedShows.length,
        items: orphanedShows,
      },
      orphanedIRL: {
        count: orphanedIRL.length,
        items: orphanedIRL,
      },
      totalOrphaned: orphaned.length,
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
    const [validShows, djData] = await Promise.all([
      buildValidShowsSet(db),
      fetchDJProfiles(db),
    ]);

    const allOrphaned = await findAllOrphaned(db, validShows, djData.validIRL, djData.validDJRadio);

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

    const showsDeleted = allOrphaned.filter(o => o.type === 'show').length;
    const irlDeleted = allOrphaned.filter(o => o.type === 'irl').length;

    console.log(`[cleanup] Deleted ${deleteCount} orphaned favorites (${showsDeleted} shows, ${irlDeleted} IRL)`);

    return NextResponse.json({
      success: true,
      deleted: deleteCount,
      showsDeleted,
      irlDeleted,
      items: allOrphaned,
    });
  } catch (error) {
    console.error("[cleanup] Error:", error);
    return NextResponse.json({ error: 'Cleanup failed', details: String(error) }, { status: 500 });
  }
}
