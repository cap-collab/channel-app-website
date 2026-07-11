/**
 * Migration A — accent-fold drift. Renames stored handles/slugs whose canonical
 * form CHANGES under the new accent-folding normalizeUsername (e.g.
 * "Sébastien Forrester": sbastienforrester -> sebastienforrester). These are
 * all unclaimed external-sync DJ profiles (audited: 0 external references) plus
 * one claimed user's field, and one collective slug (with its 4 references).
 *
 * DRY-RUN by default. Pass --execute to write.
 *
 * Determinism: the old->new set is recomputed live from the DB the same way the
 * audit does, so re-running is safe (already-migrated docs won't re-match).
 *
 *   npx tsx -r tsconfig-paths/register scripts/migrate-accent-fold-drift.ts
 *   npx tsx -r tsconfig-paths/register scripts/migrate-accent-fold-drift.ts --execute
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { getAdminDb } from '../src/lib/firebase-admin';

const EXECUTE = process.argv.includes('--execute');
const foldNew = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const foldOld = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '');

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore admin not configured');
  console.log(`Mode: ${EXECUTE ? 'EXECUTE (writing)' : 'DRY-RUN'}\n`);

  let renamed = 0, fieldUpdated = 0, skipped = 0;

  // --- 1. pending-dj-profiles: rename doc id (id IS the old folded handle) ---
  const pending = await db.collection('pending-dj-profiles').get();
  for (const d of pending.docs) {
    const display = String(d.data().chatUsername || d.data().djName || '');
    if (!display) continue;
    const neu = foldNew(display);
    if (neu === d.id || neu === foldOld(display) || d.id !== foldOld(display)) continue; // not a drift case
    const targetRef = db.collection('pending-dj-profiles').doc(neu);
    if ((await targetRef.get()).exists) { console.log(`  ⚠️ SKIP pending ${d.id} -> ${neu} (target exists)`); skipped++; continue; }
    console.log(`  pending-dj-profiles: ${d.id} -> ${neu}   "${display}"`);
    if (EXECUTE) {
      await targetRef.set({ ...d.data(), chatUsernameNormalized: neu });
      await d.ref.delete();
    }
    renamed++;
  }

  // --- 2. usernames: rename doc id (id IS the old folded handle) ---
  const usernames = await db.collection('usernames').get();
  for (const d of usernames.docs) {
    const display = String(d.data().displayName || '');
    if (!display) continue;
    const neu = foldNew(display);
    if (neu === d.id || neu === foldOld(display) || d.id !== foldOld(display)) continue;
    const targetRef = db.collection('usernames').doc(neu);
    if ((await targetRef.get()).exists) { console.log(`  ⚠️ SKIP usernames ${d.id} -> ${neu} (target exists)`); skipped++; continue; }
    console.log(`  usernames: ${d.id} -> ${neu}   "${display}"`);
    if (EXECUTE) {
      await targetRef.set({ ...d.data(), usernameHandle: neu });
      await d.ref.delete();
    }
    renamed++;
  }

  // --- 3. users: doc id is UID (stable) — only the field changes ---
  const users = await db.collection('users').where('chatUsername', '!=', '').get();
  for (const d of users.docs) {
    const display = String(d.data().chatUsername || '');
    if (!display) continue;
    const stored = String(d.data().chatUsernameNormalized || '');
    const neu = foldNew(display);
    if (neu === stored || neu === foldOld(display)) continue;
    console.log(`  users/${d.id}: chatUsernameNormalized "${stored}" -> "${neu}"   "${display}"`);
    if (EXECUTE) await d.ref.update({ chatUsernameNormalized: neu });
    fieldUpdated++;
  }

  // --- 4. collectives: slug field + its denormalized references ---
  const collectives = await db.collection('collectives').get();
  for (const d of collectives.docs) {
    const display = String(d.data().name || '');
    if (!display) continue;
    const stored = String(d.data().slug || '');
    const neu = foldNew(display);
    if (neu === stored || neu === foldOld(display)) continue;
    console.log(`\n  collectives/${d.id}: slug "${stored}" -> "${neu}"   "${display}"`);

    // 4a. self slug
    if (EXECUTE) await d.ref.update({ slug: neu });
    fieldUpdated++;

    // 4b. usernames/{oldSlug} reservation -> usernames/{newSlug}
    const oldResv = db.collection('usernames').doc(stored);
    const oldResvSnap = await oldResv.get();
    if (oldResvSnap.exists) {
      const newResv = db.collection('usernames').doc(neu);
      if ((await newResv.get()).exists) { console.log(`      ⚠️ usernames/${neu} already exists — leaving old reservation`); }
      else {
        console.log(`      usernames reservation: ${stored} -> ${neu}`);
        if (EXECUTE) { await newResv.set({ ...oldResvSnap.data(), usernameHandle: neu }); await oldResv.delete(); }
      }
    }

    // 4c. users.ownedCollectiveSlugs array
    const owners = await db.collection('users').where('ownedCollectiveSlugs', 'array-contains', stored).get();
    for (const u of owners.docs) {
      const arr = (u.data().ownedCollectiveSlugs as string[]).map((s) => (s === stored ? neu : s));
      console.log(`      users/${u.id} ownedCollectiveSlugs: ${stored} -> ${neu}`);
      if (EXECUTE) await u.ref.update({ ownedCollectiveSlugs: arr });
    }

    // 4d. broadcast-slots.djUsername (collective slots store the slug here)
    const slots = await db.collection('broadcast-slots').where('djUsername', '==', stored).get();
    for (const s of slots.docs) {
      console.log(`      broadcast-slots/${s.id} djUsername: ${stored} -> ${neu}`);
      if (EXECUTE) await s.ref.update({ djUsername: neu });
    }
  }

  console.log(`\n=== ${EXECUTE ? 'DONE' : 'DRY-RUN'}: doc renames=${renamed}, field updates=${fieldUpdated}, skipped(collision)=${skipped} ===`);
  if (!EXECUTE) console.log('Re-run with --execute to apply.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
