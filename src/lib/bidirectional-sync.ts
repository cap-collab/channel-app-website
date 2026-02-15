import type { Firestore, WriteBatch } from 'firebase-admin/firestore';

interface CollectiveRef {
  collectiveId: string;
  collectiveName: string;
  collectiveSlug?: string;
  collectivePhoto?: string | null;
}

interface CollectiveVenueRef {
  venueId: string;
  venueName: string;
}

/**
 * Compute added and removed items between old and new arrays.
 */
function diffByKey<T>(
  oldArr: T[],
  newArr: T[],
  keyFn: (item: T) => string
): { added: T[]; removed: T[] } {
  const oldIds = new Set(oldArr.map(keyFn));
  const newIds = new Set(newArr.map(keyFn));
  return {
    added: newArr.filter(item => !oldIds.has(keyFn(item))),
    removed: oldArr.filter(item => !newIds.has(keyFn(item))),
  };
}

/**
 * When collective A's linkedCollectives changes, sync the reverse side:
 * - For each added collective B: add A to B's linkedCollectives
 * - For each removed collective C: remove A from C's linkedCollectives
 */
export async function syncCollectiveToCollectives(
  batch: WriteBatch,
  db: Firestore,
  selfId: string,
  selfName: string,
  selfSlug: string,
  oldLinked: CollectiveRef[],
  newLinked: CollectiveRef[],
  selfPhoto?: string | null
): Promise<void> {
  const { added, removed } = diffByKey(oldLinked, newLinked, c => c.collectiveId);

  const selfRef: CollectiveRef = { collectiveId: selfId, collectiveName: selfName, collectiveSlug: selfSlug, collectivePhoto: selfPhoto || null };

  for (const target of added) {
    const snap = await db.collection('collectives').doc(target.collectiveId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: CollectiveRef[] = data.linkedCollectives || [];
    if (existing.some(c => c.collectiveId === selfId)) continue;
    batch.update(snap.ref, { linkedCollectives: [...existing, selfRef] });
  }

  for (const target of removed) {
    const snap = await db.collection('collectives').doc(target.collectiveId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: CollectiveRef[] = data.linkedCollectives || [];
    const filtered = existing.filter(c => c.collectiveId !== selfId);
    batch.update(snap.ref, { linkedCollectives: filtered });
  }
}

/**
 * When collective A's linkedVenues changes, sync the reverse side:
 * - For each added venue: add collective to venue's collectives array
 * - For each removed venue: remove collective from venue's collectives array
 */
export async function syncCollectiveToVenues(
  batch: WriteBatch,
  db: Firestore,
  selfId: string,
  selfName: string,
  selfSlug: string,
  oldLinkedVenues: CollectiveVenueRef[],
  newLinkedVenues: CollectiveVenueRef[],
  selfPhoto?: string | null
): Promise<void> {
  const { added, removed } = diffByKey(oldLinkedVenues, newLinkedVenues, v => v.venueId);

  const selfRef: CollectiveRef = { collectiveId: selfId, collectiveName: selfName, collectiveSlug: selfSlug, collectivePhoto: selfPhoto || null };

  for (const target of added) {
    const snap = await db.collection('venues').doc(target.venueId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: CollectiveRef[] = data.collectives || [];
    if (existing.some(c => c.collectiveId === selfId)) continue;
    batch.update(snap.ref, { collectives: [...existing, selfRef] });
  }

  for (const target of removed) {
    const snap = await db.collection('venues').doc(target.venueId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: CollectiveRef[] = data.collectives || [];
    const filtered = existing.filter(c => c.collectiveId !== selfId);
    batch.update(snap.ref, { collectives: filtered });
  }
}

/**
 * When venue X's collectives changes, sync the reverse side:
 * - For each added collective: add venue to collective's linkedVenues
 * - For each removed collective: remove venue from collective's linkedVenues
 */
export async function syncVenueToCollectives(
  batch: WriteBatch,
  db: Firestore,
  selfVenueId: string,
  selfVenueName: string,
  oldCollectives: CollectiveRef[],
  newCollectives: CollectiveRef[]
): Promise<void> {
  const { added, removed } = diffByKey(oldCollectives, newCollectives, c => c.collectiveId);

  const selfRef: CollectiveVenueRef = { venueId: selfVenueId, venueName: selfVenueName };

  for (const target of added) {
    const snap = await db.collection('collectives').doc(target.collectiveId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: CollectiveVenueRef[] = data.linkedVenues || [];
    if (existing.some(v => v.venueId === selfVenueId)) continue;
    batch.update(snap.ref, { linkedVenues: [...existing, selfRef] });
  }

  for (const target of removed) {
    const snap = await db.collection('collectives').doc(target.collectiveId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: CollectiveVenueRef[] = data.linkedVenues || [];
    const filtered = existing.filter(v => v.venueId !== selfVenueId);
    batch.update(snap.ref, { linkedVenues: filtered });
  }
}

/**
 * On collective delete: remove from all linked venues and collectives.
 */
export async function cleanupDeletedCollective(
  batch: WriteBatch,
  db: Firestore,
  collectiveId: string,
  linkedVenues: CollectiveVenueRef[],
  linkedCollectives: CollectiveRef[]
): Promise<void> {
  for (const venue of linkedVenues) {
    const snap = await db.collection('venues').doc(venue.venueId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: CollectiveRef[] = data.collectives || [];
    const filtered = existing.filter(c => c.collectiveId !== collectiveId);
    batch.update(snap.ref, { collectives: filtered });
  }

  for (const coll of linkedCollectives) {
    const snap = await db.collection('collectives').doc(coll.collectiveId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: CollectiveRef[] = data.linkedCollectives || [];
    const filtered = existing.filter(c => c.collectiveId !== collectiveId);
    batch.update(snap.ref, { linkedCollectives: filtered });
  }
}

/**
 * On venue delete: remove from all linked collectives.
 */
export async function cleanupDeletedVenue(
  batch: WriteBatch,
  db: Firestore,
  venueId: string,
  collectives: CollectiveRef[]
): Promise<void> {
  for (const coll of collectives) {
    const snap = await db.collection('collectives').doc(coll.collectiveId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: CollectiveVenueRef[] = data.linkedVenues || [];
    const filtered = existing.filter(v => v.venueId !== venueId);
    batch.update(snap.ref, { linkedVenues: filtered });
  }
}
