import type { Firestore, WriteBatch } from 'firebase-admin/firestore';

interface CollectiveRef {
  collectiveId: string;
  collectiveName: string;
  collectiveSlug?: string;
  collectivePhoto?: string | null;
}

interface EventRef {
  eventId: string;
  eventName: string;
  eventSlug?: string;
  eventDate?: number;
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
 * On collective delete: remove from all linked collectives.
 *
 * Venues are free text (no venues entity), so there is nothing to unlink there.
 */
export async function cleanupDeletedCollective(
  batch: WriteBatch,
  db: Firestore,
  collectiveId: string,
  linkedCollectives: CollectiveRef[]
): Promise<void> {
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
 * On collective delete: also remove from all linked events.
 */
export async function cleanupDeletedCollectiveEvents(
  batch: WriteBatch,
  db: Firestore,
  collectiveId: string,
  linkedEvents: EventRef[]
): Promise<void> {
  for (const evt of linkedEvents) {
    const snap = await db.collection('events').doc(evt.eventId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: CollectiveRef[] = data.linkedCollectives || [];
    const filtered = existing.filter(c => c.collectiveId !== collectiveId);
    batch.update(snap.ref, { linkedCollectives: filtered });
  }
}

/**
 * When event's linkedCollectives changes, sync the reverse side:
 * - For each added collective: add event to collective's linkedEvents
 * - For each removed collective: remove event from collective's linkedEvents
 */
export async function syncEventToCollectives(
  batch: WriteBatch,
  db: Firestore,
  selfEventId: string,
  selfEventName: string,
  selfEventSlug: string,
  selfEventDate: number,
  oldLinkedCollectives: CollectiveRef[],
  newLinkedCollectives: CollectiveRef[]
): Promise<void> {
  const { added, removed } = diffByKey(oldLinkedCollectives, newLinkedCollectives, c => c.collectiveId);

  const selfRef: EventRef = { eventId: selfEventId, eventName: selfEventName, eventSlug: selfEventSlug, eventDate: selfEventDate };

  for (const target of added) {
    if (!target.collectiveId) continue; // free-text collective: no doc to reverse-link
    const snap = await db.collection('collectives').doc(target.collectiveId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: EventRef[] = data.linkedEvents || [];
    if (existing.some(e => e.eventId === selfEventId)) continue;
    batch.update(snap.ref, { linkedEvents: [...existing, selfRef] });
  }

  for (const target of removed) {
    if (!target.collectiveId) continue; // free-text collective: nothing was reverse-linked
    const snap = await db.collection('collectives').doc(target.collectiveId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: EventRef[] = data.linkedEvents || [];
    const filtered = existing.filter(e => e.eventId !== selfEventId);
    batch.update(snap.ref, { linkedEvents: filtered });
  }
}

/**
 * When collective's linkedEvents changes, sync the reverse side:
 * - For each added event: add collective to event's linkedCollectives
 * - For each removed event: remove collective from event's linkedCollectives
 */
export async function syncCollectiveToEvents(
  batch: WriteBatch,
  db: Firestore,
  selfId: string,
  selfName: string,
  selfSlug: string,
  oldLinkedEvents: EventRef[],
  newLinkedEvents: EventRef[],
  selfPhoto?: string | null
): Promise<void> {
  const { added, removed } = diffByKey(oldLinkedEvents, newLinkedEvents, e => e.eventId);

  const selfRef: CollectiveRef = { collectiveId: selfId, collectiveName: selfName, collectiveSlug: selfSlug, collectivePhoto: selfPhoto || null };

  for (const target of added) {
    const snap = await db.collection('events').doc(target.eventId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: CollectiveRef[] = data.linkedCollectives || [];
    if (existing.some(c => c.collectiveId === selfId)) continue;
    batch.update(snap.ref, { linkedCollectives: [...existing, selfRef] });
  }

  for (const target of removed) {
    const snap = await db.collection('events').doc(target.eventId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: CollectiveRef[] = data.linkedCollectives || [];
    const filtered = existing.filter(c => c.collectiveId !== selfId);
    batch.update(snap.ref, { linkedCollectives: filtered });
  }
}

/**
 * On event delete: remove from all linked collectives.
 *
 * Venues are free text (no venues entity), so there is nothing to unlink there.
 */
export async function cleanupDeletedEvent(
  batch: WriteBatch,
  db: Firestore,
  eventId: string,
  linkedCollectives: CollectiveRef[]
): Promise<void> {
  for (const coll of linkedCollectives) {
    const snap = await db.collection('collectives').doc(coll.collectiveId).get();
    if (!snap.exists) continue;
    const data = snap.data()!;
    const existing: EventRef[] = data.linkedEvents || [];
    const filtered = existing.filter(e => e.eventId !== eventId);
    batch.update(snap.ref, { linkedEvents: filtered });
  }
}
