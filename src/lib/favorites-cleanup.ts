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
