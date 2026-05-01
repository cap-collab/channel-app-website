import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';

/**
 * After a collective broadcast ends, copy chat messages from the canonical
 * collective room into each owner's per-DJ room. Idempotent — destination
 * docs use deterministic IDs derived from the source doc ID.
 *
 * Returns the number of (room, message) writes attempted.
 */
export async function copyCollectiveChatToOwners(
  db: Firestore,
  opts: {
    collectiveSlug: string;     // canonical chat room key (e.g. "pollensourceb2bcron")
    windowStartMs: number;      // inclusive lower bound on message timestamp
    windowEndMs: number;        // inclusive upper bound
  },
): Promise<{ writes: number; ownerRooms: string[] }> {
  // 1. Look up the collective by slug.
  const collectiveSnap = await db.collection('collectives')
    .where('slug', '==', opts.collectiveSlug)
    .limit(1)
    .get();
  if (collectiveSnap.empty) {
    return { writes: 0, ownerRooms: [] };
  }
  const cData = collectiveSnap.docs[0].data();
  const ownerUids: string[] = Array.isArray(cData.owners) ? cData.owners : [];
  if (ownerUids.length === 0) return { writes: 0, ownerRooms: [] };

  // 2. Resolve each owner's chatUsernameNormalized (the destination room key).
  const ownerRooms: string[] = [];
  for (let i = 0; i < ownerUids.length; i += 10) {
    const chunk = ownerUids.slice(i, i + 10);
    const ownersSnap = await db.collection('users')
      .where('__name__', 'in', chunk)
      .get();
    ownersSnap.forEach(u => {
      const cu = u.data().chatUsernameNormalized;
      if (typeof cu === 'string' && cu.length > 0) ownerRooms.push(cu);
    });
  }
  if (ownerRooms.length === 0) return { writes: 0, ownerRooms: [] };

  // 3. Read all messages from the canonical room in the window.
  const sourceRef = db.collection('chats').doc(opts.collectiveSlug).collection('messages');
  const sourceSnap = await sourceRef
    .where('timestamp', '>=', Timestamp.fromMillis(opts.windowStartMs))
    .where('timestamp', '<=', Timestamp.fromMillis(opts.windowEndMs))
    .get();

  if (sourceSnap.empty) return { writes: 0, ownerRooms };

  // 4. Fan out into each owner's room with deterministic IDs.
  let writes = 0;
  for (const doc of sourceSnap.docs) {
    const data = doc.data();
    const destDocId = `${opts.collectiveSlug}__${doc.id}`;
    for (const room of ownerRooms) {
      const destRef = db.collection('chats').doc(room).collection('messages').doc(destDocId);
      await destRef.set({ ...data, stationId: room }, { merge: true });
      writes++;
    }
  }

  return { writes, ownerRooms };
}
