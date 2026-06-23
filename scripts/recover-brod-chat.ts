/**
 * THROWAWAY one-time recovery (delete after running).
 *
 * The 2026-06-23 "B. Rod b2b David L" collective broadcast wrote its live chat
 * to the phantom dotted room `chats/b.rodb2bdavidl` because computeDJChatRoom
 * kept the dot. The post-show webhook copy read the canonical slug room
 * (`brodb2bdavidl`, nearly empty), so nothing reached the collective or owners.
 *
 * This copies the stranded messages into:
 *   - chats/brodb2bdavidl  (canonical collective slug room — where the copy
 *                           function & collective page read from)
 *   - chats/davidl         (owner David L's per-DJ room)
 *   - chats/brod           (owner B. Rod's per-DJ room)
 *
 * Idempotent: deterministic dest doc IDs + merge, so re-running is a no-op.
 * Writes only the messages we copy (never rewrites whole docs elsewhere).
 */
import './lib/load-env';
import { getAdminDb } from '../src/lib/firebase-admin';

const SOURCE_ROOM = 'b.rodb2bdavidl';
const DEST_ROOMS = ['brodb2bdavidl', 'davidl', 'brod'];

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('no db');

  const srcSnap = await db.collection('chats').doc(SOURCE_ROOM).collection('messages').get();
  console.log(`source room "${SOURCE_ROOM}": ${srcSnap.size} messages`);
  if (srcSnap.empty) {
    console.log('nothing to copy');
    return;
  }

  let writes = 0;
  for (const doc of srcSnap.docs) {
    const data = doc.data();
    const destDocId = `${SOURCE_ROOM}__${doc.id}`;
    for (const room of DEST_ROOMS) {
      const destRef = db.collection('chats').doc(room).collection('messages').doc(destDocId);
      // stationId must match the destination room (mirrors copyCollectiveChatToOwners).
      await destRef.set({ ...data, stationId: room }, { merge: true });
      writes++;
    }
  }
  console.log(`copied ${srcSnap.size} messages into ${DEST_ROOMS.length} rooms = ${writes} writes`);

  // Verify
  for (const room of DEST_ROOMS) {
    const n = await db.collection('chats').doc(room).collection('messages').get();
    console.log(`  room "${room}": now ${n.size} messages`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
