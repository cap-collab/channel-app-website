/**
 * Backfill `sceneSlugs` on existing archive docs from each archive's primary
 * DJ scene tags (users/{uid}.djProfile.sceneIds).
 *
 * Skips archives that already have an explicit `sceneIdsOverride` so admin
 * curation isn't blown away. The new field is `sceneSlugs` (denormalized
 * snapshot) and lives next to djs/showImageUrl on the archive doc.
 *
 * Dry-run by default. Re-run with --execute to actually write.
 *
 * Run:
 *   npx tsx -r tsconfig-paths/register scripts/backfill-archive-scenes.ts
 *   npx tsx -r tsconfig-paths/register scripts/backfill-archive-scenes.ts --execute
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { getAdminDb } from '../src/lib/firebase-admin';

const EXECUTE = process.argv.includes('--execute');

type DJ = {
  name?: string;
  username?: string;
  userId?: string;
};

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore admin not configured');
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);

  // Build DJ → sceneIds map (mirrors useScenesData on the client).
  const sceneByUserId = new Map<string, string[]>();
  const sceneByUsername = new Map<string, string[]>();
  const usersSnap = await db
    .collection('users')
    .where('role', 'in', ['dj', 'broadcaster', 'admin'])
    .get();
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const sceneIds: string[] = data?.djProfile?.sceneIds ?? [];
    if (!Array.isArray(sceneIds) || sceneIds.length === 0) continue;
    sceneByUserId.set(doc.id, sceneIds);
    const normalized =
      typeof data?.chatUsernameNormalized === 'string'
        ? data.chatUsernameNormalized
        : typeof data?.chatUsername === 'string'
          ? data.chatUsername.toLowerCase().replace(/\s+/g, '')
          : null;
    if (normalized) sceneByUsername.set(normalized, sceneIds);
  }
  console.log(
    `Loaded scene map: ${sceneByUserId.size} userIds, ${sceneByUsername.size} usernames`,
  );

  const archivesSnap = await db.collection('archives').get();
  console.log(`Loaded ${archivesSnap.size} archives.`);

  let updated = 0;
  let skippedHasOverride = 0;
  let skippedHasScenes = 0;
  let skippedNoMatch = 0;

  for (const doc of archivesSnap.docs) {
    const data = doc.data();
    if (Array.isArray(data.sceneIdsOverride)) {
      skippedHasOverride++;
      continue;
    }
    if (Array.isArray(data.sceneSlugs) && data.sceneSlugs.length > 0) {
      skippedHasScenes++;
      continue;
    }

    const djs: DJ[] = Array.isArray(data.djs) ? data.djs : [];
    const set = new Set<string>();
    for (const dj of djs) {
      if (dj.userId) {
        const ids = sceneByUserId.get(dj.userId);
        if (ids) ids.forEach((id) => set.add(id));
      }
      if (dj.username) {
        const key = dj.username.toLowerCase().replace(/\s+/g, '');
        const ids = sceneByUsername.get(key);
        if (ids) ids.forEach((id) => set.add(id));
      }
    }
    if (set.size === 0) {
      skippedNoMatch++;
      continue;
    }
    const sceneSlugs = Array.from(set);
    console.log(`  ${doc.id} (${data.showName || data.slug}) → ${sceneSlugs.join(', ')}`);
    if (EXECUTE) {
      await doc.ref.update({ sceneSlugs });
    }
    updated++;
  }

  console.log('---');
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (sceneIdsOverride set): ${skippedHasOverride}`);
  console.log(`Skipped (sceneSlugs already set): ${skippedHasScenes}`);
  console.log(`Skipped (no DJ match in scene map): ${skippedNoMatch}`);
  if (!EXECUTE) {
    console.log('\nDry-run only. Re-run with --execute to write.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
