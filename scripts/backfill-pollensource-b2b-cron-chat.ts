/**
 * One-off backfill for the Pollensource b2b Cron broadcast (yesterday, 4 hours).
 *
 * The broadcast happened before collectives were wired up — chat went only to
 * `chats/pollensource/messages` (and cross-posted to `chats/channelbroadcast/messages`).
 * After-the-fact we want:
 *   1) Every system message (love / lockedin) that mentions "pollensource" in
 *      the time window updated to read "Pollensource b2b Cron". Applied to
 *      both the per-DJ room AND the channelbroadcast room.
 *   2) ALL messages in the window copied into the collective room
 *      (chats/pollensourceb2bcron/messages) and into Cron's room
 *      (chats/cron/messages). Originals stay in chats/pollensource/messages.
 *
 * Idempotent: copied messages get a deterministic doc ID
 * `pollensource__<sourceMessageId>` so re-runs `set()` over the same docs
 * with no net change.
 *
 * Dry-run by default. Pass --execute to apply writes.
 *
 *   npx tsx -r tsconfig-paths/register scripts/backfill-pollensource-b2b-cron-chat.ts
 *   npx tsx -r tsconfig-paths/register scripts/backfill-pollensource-b2b-cron-chat.ts --execute
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { getAdminDb } from '../src/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

const EXECUTE = process.argv.includes('--execute');

// Source archive: RJdN6uQak3KoqzNHUf0J
// recordedAt = 1777597200000  → 2026-04-30 21:00:00 UTC
// duration   = 14396 seconds  → 3h 59m 56s
const WINDOW_START_MS = 1777597200000;
const WINDOW_END_MS   = WINDOW_START_MS + 14396 * 1000; // 1777611596000

const SOURCE_ROOM      = 'pollensource';
const COLLECTIVE_ROOM  = 'pollensourceb2bcron';
const CO_DJ_ROOM       = 'cron';
const COLLECTIVE_NAME  = 'Pollensource b2b Cron';
const OLD_DJ_NAME      = 'pollensource';

type ChatMessage = {
  stationId?: string;
  username?: string;
  message?: string;
  timestamp?: Timestamp;
  isDJ?: boolean;
  messageType?: string;
  heartCount?: number;
  djSlotId?: string;
  [k: string]: unknown;
};

/** Replace "pollensource" with "Pollensource b2b Cron" in love / locked-in
 *  message text. The text is case-sensitive only where the original code put
 *  the username (`is ❤️ ${djUsername}` and `is locked in 🔐 with ${djUsername}`),
 *  so we replace once after each fixed phrase. */
function rewriteSystemMessageText(text: string): string {
  if (!text) return text;
  // "X is ❤️ pollensource"
  let out = text.replace(/(is ❤️\s+)pollensource\b/i, `$1${COLLECTIVE_NAME}`);
  // "X is locked in 🔐 with pollensource"
  out = out.replace(/(is locked in 🔐 with\s+)pollensource\b/i, `$1${COLLECTIVE_NAME}`);
  return out;
}

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore admin not configured');

  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`Window: ${new Date(WINDOW_START_MS).toISOString()} → ${new Date(WINDOW_END_MS).toISOString()}`);

  // 1. Load all messages from the source room in the time window.
  const sourceRef = db.collection('chats').doc(SOURCE_ROOM).collection('messages');
  const sourceSnap = await sourceRef
    .where('timestamp', '>=', Timestamp.fromMillis(WINDOW_START_MS))
    .where('timestamp', '<=', Timestamp.fromMillis(WINDOW_END_MS))
    .get();

  console.log(`Found ${sourceSnap.size} messages in chats/${SOURCE_ROOM} for the window.`);

  // 2. Load all messages from channelbroadcast in the same window (system
  //    messages we need to rewrite there too).
  const broadcastRef = db.collection('chats').doc('channelbroadcast').collection('messages');
  const broadcastSnap = await broadcastRef
    .where('timestamp', '>=', Timestamp.fromMillis(WINDOW_START_MS))
    .where('timestamp', '<=', Timestamp.fromMillis(WINDOW_END_MS))
    .get();

  console.log(`Found ${broadcastSnap.size} messages in chats/channelbroadcast for the window.`);

  let editedSourceCount = 0;
  let editedBroadcastCount = 0;
  let copiedToCollective = 0;
  let copiedToCron = 0;

  // 3. Per-DJ source room: rewrite system-message text in place + collect for copy.
  const messagesToCopy: { id: string; data: ChatMessage }[] = [];

  for (const doc of sourceSnap.docs) {
    const data = doc.data() as ChatMessage;
    const id = doc.id;

    // Rewrite system-message text in the source room.
    if ((data.messageType === 'love' || data.messageType === 'lockedin') && data.message) {
      const updated = rewriteSystemMessageText(data.message);
      if (updated !== data.message) {
        editedSourceCount++;
        if (EXECUTE) {
          await sourceRef.doc(id).update({ message: updated });
        } else {
          console.log(`  [edit ${SOURCE_ROOM}/${id}] "${data.message}" → "${updated}"`);
        }
      }
    }

    messagesToCopy.push({ id, data });
  }

  // 4. channelbroadcast: rewrite system-message text only (no copy).
  for (const doc of broadcastSnap.docs) {
    const data = doc.data() as ChatMessage;
    const id = doc.id;

    // Only rewrite messages that mention pollensource — this room has all
    // shows mixed together so we don't want to touch unrelated messages.
    if (
      (data.messageType === 'love' || data.messageType === 'lockedin') &&
      data.message &&
      new RegExp(`\\b${OLD_DJ_NAME}\\b`, 'i').test(data.message)
    ) {
      const updated = rewriteSystemMessageText(data.message);
      if (updated !== data.message) {
        editedBroadcastCount++;
        if (EXECUTE) {
          await broadcastRef.doc(id).update({ message: updated });
        } else {
          console.log(`  [edit channelbroadcast/${id}] "${data.message}" → "${updated}"`);
        }
      }
    }
  }

  // 5. Copy ALL source-room messages (post-edit) into the collective + Cron rooms.
  //    Use deterministic doc IDs so re-runs are idempotent.
  const collectiveRef = db.collection('chats').doc(COLLECTIVE_ROOM).collection('messages');
  const cronRef       = db.collection('chats').doc(CO_DJ_ROOM).collection('messages');

  for (const { id, data } of messagesToCopy) {
    // Build the message body to write to the destination rooms. For system
    // messages, use the rewritten text (so the destination rooms get the
    // collective name). For chat/regular messages, copy as-is.
    let messageText = data.message;
    if ((data.messageType === 'love' || data.messageType === 'lockedin') && data.message) {
      messageText = rewriteSystemMessageText(data.message);
    }

    const collectiveDocId = `pollensource__${id}`;
    const cronDocId       = `pollensource__${id}`;

    const collectiveData: ChatMessage = {
      ...data,
      stationId: COLLECTIVE_ROOM,
      message: messageText,
    };
    const cronData: ChatMessage = {
      ...data,
      stationId: CO_DJ_ROOM,
      message: messageText,
    };

    if (EXECUTE) {
      await collectiveRef.doc(collectiveDocId).set(collectiveData, { merge: true });
      await cronRef.doc(cronDocId).set(cronData, { merge: true });
    } else {
      console.log(`  [copy ${SOURCE_ROOM}/${id} → ${COLLECTIVE_ROOM}/${collectiveDocId}]`);
      console.log(`  [copy ${SOURCE_ROOM}/${id} → ${CO_DJ_ROOM}/${cronDocId}]`);
    }
    copiedToCollective++;
    copiedToCron++;
  }

  console.log('');
  console.log('Summary:');
  console.log(`  Edited in chats/${SOURCE_ROOM}/messages:        ${editedSourceCount}`);
  console.log(`  Edited in chats/channelbroadcast/messages:      ${editedBroadcastCount}`);
  console.log(`  Copied to chats/${COLLECTIVE_ROOM}/messages:    ${copiedToCollective}`);
  console.log(`  Copied to chats/${CO_DJ_ROOM}/messages:         ${copiedToCron}`);
  console.log('');
  console.log(EXECUTE ? '✓ Writes applied.' : 'Dry-run only. Re-run with --execute to apply.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
