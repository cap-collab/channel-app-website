/**
 * One-off migration: rename the "diamond" scene to "star" across Firestore.
 *
 * Usage:
 *   Dry-run (default, prints what would change):
 *     set -a && source .env.production && set +a && \
 *     npx ts-node -O '{"module":"commonjs"}' --skip-project scripts/rename-diamond-to-star.ts
 *
 *   Live run:
 *     ... scripts/rename-diamond-to-star.ts --confirm
 *
 * What it touches:
 *   - scenes/diamond           → clone into scenes/star (override name+emoji), delete old doc
 *   - users.djProfile.sceneIds           (array)
 *   - users.preferredSceneIds             (array)
 *   - users.favoriteSceneIds              (array)
 *   - broadcast-slots.sceneIdsOverride    (array)
 *   - archives.sceneIdsOverride           (array)
 *   - events.sceneIdsOverride             (array)
 *   - collectives.sceneIds                (array)
 *   - venues.sceneIds                     (array)
 *   - pending-dj-profiles.djProfile.sceneIds (array)
 *
 * Idempotent: running twice is safe — arrayRemove/arrayUnion won't duplicate.
 */

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const OLD = 'diamond';
const NEW = 'star';
const NEW_NAME = 'Star';
const NEW_EMOJI = '✳';

const CONFIRM = process.argv.includes('--confirm');

if (!admin.apps.length) {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      'Missing credentials. Need NEXT_PUBLIC_FIREBASE_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY.'
    );
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

const db = admin.firestore();

// Generic helper: rewrite a top-level array field on any doc that array-contains OLD.
async function migrateArrayField(collection: string, field: string): Promise<number> {
  const snap = await db.collection(collection).where(field, 'array-contains', OLD).get();
  if (snap.empty) {
    console.log(`  [${collection}.${field}] no docs contain '${OLD}'`);
    return 0;
  }
  console.log(`  [${collection}.${field}] ${snap.size} doc(s) to update`);
  for (const doc of snap.docs) {
    console.log(`    ${CONFIRM ? 'updating' : '[dry-run]'} ${collection}/${doc.id}`);
    if (CONFIRM) {
      await doc.ref.update({
        [field]: FieldValue.arrayUnion(NEW),
      });
      await doc.ref.update({
        [field]: FieldValue.arrayRemove(OLD),
      });
    }
  }
  return snap.size;
}

// users.djProfile.sceneIds and pending-dj-profiles.djProfile.sceneIds — nested path.
// Firestore supports nested-field arrayRemove/arrayUnion via dot-notation.
async function migrateNestedDjSceneIds(collection: string): Promise<number> {
  const snap = await db
    .collection(collection)
    .where('djProfile.sceneIds', 'array-contains', OLD)
    .get();
  if (snap.empty) {
    console.log(`  [${collection}.djProfile.sceneIds] no docs contain '${OLD}'`);
    return 0;
  }
  console.log(`  [${collection}.djProfile.sceneIds] ${snap.size} doc(s) to update`);
  for (const doc of snap.docs) {
    console.log(`    ${CONFIRM ? 'updating' : '[dry-run]'} ${collection}/${doc.id}`);
    if (CONFIRM) {
      await doc.ref.update({
        'djProfile.sceneIds': FieldValue.arrayUnion(NEW),
      });
      await doc.ref.update({
        'djProfile.sceneIds': FieldValue.arrayRemove(OLD),
      });
    }
  }
  return snap.size;
}

// scenes/diamond → scenes/star (clone with overrides, delete old)
async function migrateScenesDoc(): Promise<void> {
  const oldRef = db.collection('scenes').doc(OLD);
  const newRef = db.collection('scenes').doc(NEW);
  const [oldSnap, newSnap] = await Promise.all([oldRef.get(), newRef.get()]);

  if (!oldSnap.exists) {
    console.log(`  [scenes] no scenes/${OLD} doc found`);
    if (newSnap.exists) {
      console.log(`  [scenes] scenes/${NEW} already exists — nothing to do`);
    }
    return;
  }

  if (newSnap.exists) {
    console.log(`  [scenes] scenes/${NEW} already exists; will still delete scenes/${OLD}`);
  } else {
    const data = (oldSnap.data() || {}) as Record<string, unknown>;
    const cloned: Record<string, unknown> = {
      ...data,
      name: NEW_NAME,
      emoji: NEW_EMOJI,
      updatedAt: FieldValue.serverTimestamp(),
    };
    console.log(`  [scenes] ${CONFIRM ? 'creating' : '[dry-run]'} scenes/${NEW}`);
    console.log(`           fields:`, { name: cloned.name, emoji: cloned.emoji, color: cloned.color, order: cloned.order });
    if (CONFIRM) {
      await newRef.set(cloned);
    }
  }

  console.log(`  [scenes] ${CONFIRM ? 'deleting' : '[dry-run]'} scenes/${OLD}`);
  if (CONFIRM) {
    await oldRef.delete();
  }
}

async function main() {
  console.log(`\n=== Rename '${OLD}' → '${NEW}' ===`);
  console.log(`Mode: ${CONFIRM ? 'LIVE' : 'DRY-RUN (use --confirm to write)'}\n`);

  console.log('1. scenes doc');
  await migrateScenesDoc();

  console.log('\n2. users.djProfile.sceneIds');
  const a = await migrateNestedDjSceneIds('users');

  console.log('\n3. users.preferredSceneIds');
  const b = await migrateArrayField('users', 'preferredSceneIds');

  console.log('\n4. users.favoriteSceneIds');
  const c = await migrateArrayField('users', 'favoriteSceneIds');

  console.log('\n5. broadcast-slots.sceneIdsOverride');
  const d = await migrateArrayField('broadcast-slots', 'sceneIdsOverride');

  console.log('\n6. archives.sceneIdsOverride');
  const e = await migrateArrayField('archives', 'sceneIdsOverride');

  console.log('\n7. events.sceneIdsOverride');
  const f = await migrateArrayField('events', 'sceneIdsOverride');

  console.log('\n8. collectives.sceneIds');
  const g = await migrateArrayField('collectives', 'sceneIds');

  console.log('\n9. venues.sceneIds');
  const h = await migrateArrayField('venues', 'sceneIds');

  console.log('\n10. pending-dj-profiles.djProfile.sceneIds');
  const i = await migrateNestedDjSceneIds('pending-dj-profiles');

  const total = a + b + c + d + e + f + g + h + i;
  console.log(`\n=== Total array-field updates: ${total} ===`);
  if (!CONFIRM) console.log(`(dry-run — re-run with --confirm to apply)`);
}

main()
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
