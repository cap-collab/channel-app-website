import { getAdminDb } from '@/lib/firebase-admin';

/**
 * Delete all user favorites matching a specific show (by term + stationId).
 * Uses collectionGroup query on 'favorites' subcollections across all users.
 */
export async function cleanupFavoritesForShow(
  term: string,
  stationId: string
): Promise<number> {
  const db = getAdminDb();
  if (!db) return 0;

  const snapshot = await db.collectionGroup('favorites')
    .where('term', '==', term.toLowerCase())
    .get();

  if (snapshot.empty) return 0;

  // Filter by stationId in memory (avoids needing a composite index)
  const toDelete = snapshot.docs.filter(doc => {
    const data = doc.data();
    return data.stationId === stationId;
  });

  if (toDelete.length === 0) return 0;

  // Batch delete (max 500 per batch)
  let deleteCount = 0;
  let batch = db.batch();

  for (const doc of toDelete) {
    batch.delete(doc.ref);
    deleteCount++;

    if (deleteCount % 500 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }

  if (deleteCount % 500 !== 0) {
    await batch.commit();
  }

  console.log(`[favorites-cleanup] Deleted ${deleteCount} favorites for "${term}" (${stationId})`);
  return deleteCount;
}

/**
 * Delete all show-type favorites matching a given show name across all stations.
 * Used when an event is deleted and we don't know the stationId.
 */
export async function cleanupFavoritesForShowName(
  showName: string
): Promise<number> {
  const db = getAdminDb();
  if (!db) return 0;

  const snapshot = await db.collectionGroup('favorites')
    .where('term', '==', showName.toLowerCase())
    .where('type', '==', 'show')
    .get();

  if (snapshot.empty) return 0;

  let deleteCount = 0;
  let batch = db.batch();

  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    deleteCount++;

    if (deleteCount % 500 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }

  if (deleteCount % 500 !== 0) {
    await batch.commit();
  }

  console.log(`[favorites-cleanup] Deleted ${deleteCount} favorites for show name "${showName}"`);
  return deleteCount;
}

/**
 * Delete all IRL-type favorites matching a specific event.
 * Reconstructs the IRL favorite key from event data (djUsername + date + location).
 * Used when an admin event with a location (IRL event) is deleted.
 */
export async function cleanupFavoritesForIRLEvent(
  djUsername: string,
  date: string,    // YYYY-MM-DD
  location: string
): Promise<number> {
  const db = getAdminDb();
  if (!db) return 0;

  const irlKey = `irl-${djUsername}-${date}-${location}`.toLowerCase();

  const snapshot = await db.collectionGroup('favorites')
    .where('term', '==', irlKey)
    .where('type', '==', 'irl')
    .get();

  if (snapshot.empty) return 0;

  let deleteCount = 0;
  let batch = db.batch();

  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    deleteCount++;

    if (deleteCount % 500 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }

  if (deleteCount % 500 !== 0) {
    await batch.commit();
  }

  console.log(`[favorites-cleanup] Deleted ${deleteCount} IRL favorites for "${irlKey}"`);
  return deleteCount;
}

/**
 * Delete all IRL-type favorites for a pending DJ profile's IRL shows.
 * Used when a pending DJ profile is deleted from the admin panel.
 */
export async function cleanupFavoritesForPendingDJ(
  djUsername: string,
  irlShows: Array<{ date: string; location?: string; name?: string }>
): Promise<number> {
  let totalDeleted = 0;

  for (const show of irlShows) {
    if (!show.location) continue;
    const count = await cleanupFavoritesForIRLEvent(djUsername, show.date, show.location);
    totalDeleted += count;
  }

  return totalDeleted;
}
