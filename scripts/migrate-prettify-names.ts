/**
 * Migration B — prettify two display names to use special characters. The
 * canonical handle folds back to the SAME value, so no doc-id / djUsername /
 * slug / URL changes — only DISPLAY fields (chatUsername / displayName /
 * djs[].djName). Handles verified: normalizeUsername("agraybé")==="agraybe",
 * normalizeUsername("fleet.dreams")==="fleetdreams".
 *
 *   agraybe     -> "agraybé"      (lowercase, per Cap)
 *   fleetdreams -> "fleet.dreams"
 *
 * DRY-RUN by default. Pass --execute to write.
 *
 *   npx tsx -r tsconfig-paths/register scripts/migrate-prettify-names.ts
 *   npx tsx -r tsconfig-paths/register scripts/migrate-prettify-names.ts --execute
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { getAdminDb } from '../src/lib/firebase-admin';

const EXECUTE = process.argv.includes('--execute');
const fold = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// handle -> pretty display. Only fields whose CURRENT value folds to `handle`
// are rewritten to `pretty`, so we never touch a same-named different DJ.
const RENAMES: Array<{ handle: string; pretty: string }> = [
  { handle: 'agraybe', pretty: 'agraybé' },
  { handle: 'fleetdreams', pretty: 'fleet.dreams' },
];

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore admin not configured');
  console.log(`Mode: ${EXECUTE ? 'EXECUTE (writing)' : 'DRY-RUN'}\n`);

  for (const { handle, pretty } of RENAMES) {
    // Safety: pretty must fold back to handle, else we'd change the URL/identity.
    if (fold(pretty) !== handle) throw new Error(`REFUSING: "${pretty}" folds to "${fold(pretty)}", not "${handle}"`);
    console.log(`\n══ ${handle} -> "${pretty}" ══`);
    let n = 0;
    const set = async (ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>, label: string) => {
      console.log(`  ${label}`);
      if (EXECUTE) await ref.update(data);
      n++;
    };
    const matches = (v: unknown) => typeof v === 'string' && fold(v) === handle && v !== pretty;

    // users.chatUsername
    const users = await db.collection('users').where('chatUsernameNormalized', '==', handle).get();
    for (const d of users.docs) if (matches(d.data().chatUsername)) await set(d.ref, { chatUsername: pretty }, `users/${d.id} chatUsername "${d.data().chatUsername}" -> "${pretty}"`);

    // pending-dj-profiles.chatUsername (by field, doc id may be random)
    const pend = await db.collection('pending-dj-profiles').where('chatUsernameNormalized', '==', handle).get();
    for (const d of pend.docs) if (matches(d.data().chatUsername)) await set(d.ref, { chatUsername: pretty }, `pending-dj-profiles/${d.id} chatUsername "${d.data().chatUsername}" -> "${pretty}"`);

    // usernames/{handle}.displayName (doc id is the handle; only if it exists)
    const un = await db.collection('usernames').doc(handle).get();
    if (un.exists && matches(un.data()?.displayName)) await set(un.ref, { displayName: pretty }, `usernames/${handle} displayName "${un.data()?.displayName}" -> "${pretty}"`);

    // events.djs[].djName
    const events = await db.collection('events').get();
    for (const d of events.docs) {
      const djs = Array.isArray(d.data().djs) ? [...(d.data().djs as Record<string, unknown>[])] : [];
      let changed = false;
      djs.forEach((dj, i) => { if (fold(String(dj.djUsername || dj.djName || '')) === handle && matches(dj.djName)) { djs[i] = { ...dj, djName: pretty }; changed = true; } });
      if (changed) await set(d.ref, { djs }, `events/${d.id} ("${d.data().name}") djs[].djName -> "${pretty}"`);
    }

    // collectives residentDJs[] / guestDJs[] .djName
    const colls = await db.collection('collectives').get();
    for (const d of colls.docs) {
      const update: Record<string, unknown> = {};
      for (const key of ['residentDJs', 'guestDJs']) {
        const arr = Array.isArray(d.data()[key]) ? [...(d.data()[key] as Record<string, unknown>[])] : [];
        let changed = false;
        arr.forEach((dj, i) => { if (fold(String(dj.djUsername || dj.djName || '')) === handle && matches(dj.djName)) { arr[i] = { ...dj, djName: pretty }; changed = true; } });
        if (changed) update[key] = arr;
      }
      if (Object.keys(update).length) await set(d.ref, update, `collectives/${d.id} ("${d.data().name}") ${Object.keys(update).join('+')}[].djName -> "${pretty}"`);
    }

    console.log(`  (${n} doc${n === 1 ? '' : 's'} ${EXECUTE ? 'updated' : 'would update'})`);
  }

  console.log(`\n=== ${EXECUTE ? 'DONE' : 'DRY-RUN'} ===`);
  if (!EXECUTE) console.log('Re-run with --execute to apply.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
