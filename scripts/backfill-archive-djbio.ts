/**
 * Backfill djs[].bio on existing archives from users/{uid}.djProfile.bio
 * (or pending-dj-profiles by username).
 *
 * Dry-run by default — prints a plan + summary. Re-run with --execute to
 * actually write. Never overwrites a bio that's already set on the archive.
 *
 * Run:
 *   npx tsx -r tsconfig-paths/register scripts/backfill-archive-djbio.ts
 *   npx tsx -r tsconfig-paths/register scripts/backfill-archive-djbio.ts --execute
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { writeFileSync, mkdirSync } from 'fs';
import { getAdminDb } from '../src/lib/firebase-admin';

const EXECUTE = process.argv.includes('--execute');

type DJ = {
  name?: string;
  username?: string;
  userId?: string;
  bio?: string;
  [k: string]: unknown;
};

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore admin not configured');

  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);

  // 1. Load all archives.
  const archivesSnap = await db.collection('archives').get();
  console.log(`Loaded ${archivesSnap.size} archives.`);

  // 2. Build user-bio lookup tables for the userIds + usernames we need.
  const neededUserIds = new Set<string>();
  const neededUsernames = new Set<string>();
  for (const doc of archivesSnap.docs) {
    const djs = (doc.data().djs || []) as DJ[];
    for (const dj of djs) {
      if (dj.bio) continue; // already has one — skip lookup
      if (dj.userId) neededUserIds.add(dj.userId);
      else if (dj.username) neededUsernames.add(dj.username.replace(/[\s-]+/g, '').toLowerCase());
    }
  }
  console.log(`Need to look up ${neededUserIds.size} userIds + ${neededUsernames.size} usernames.`);

  const bioByUserId = new Map<string, string>();
  const bioByUsername = new Map<string, string>();

  // Batch get users by userId (in chunks of 30 — Firestore `in` query limit)
  const userIdList = [...neededUserIds];
  for (let i = 0; i < userIdList.length; i += 30) {
    const batch = userIdList.slice(i, i + 30);
    const snap = await db.collection('users').where('__name__', 'in', batch).get();
    for (const doc of snap.docs) {
      const bio = doc.data()?.djProfile?.bio;
      if (typeof bio === 'string' && bio.trim().length > 0) {
        bioByUserId.set(doc.id, bio);
      }
    }
  }

  // Batch get users by chatUsernameNormalized
  const usernameList = [...neededUsernames];
  for (let i = 0; i < usernameList.length; i += 30) {
    const batch = usernameList.slice(i, i + 30);
    const snap = await db
      .collection('users')
      .where('chatUsernameNormalized', 'in', batch)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const bio = data?.djProfile?.bio;
      const normalized = data?.chatUsernameNormalized as string | undefined;
      if (normalized && typeof bio === 'string' && bio.trim().length > 0) {
        bioByUsername.set(normalized, bio);
      }
    }
  }

  // Also try pending-dj-profiles for usernames we still don't have a bio for
  const stillMissing = usernameList.filter((u) => !bioByUsername.has(u));
  for (let i = 0; i < stillMissing.length; i += 30) {
    const batch = stillMissing.slice(i, i + 30);
    const snap = await db
      .collection('pending-dj-profiles')
      .where('chatUsernameNormalized', 'in', batch)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const bio = data?.bio ?? data?.djProfile?.bio;
      const normalized = data?.chatUsernameNormalized as string | undefined;
      if (normalized && typeof bio === 'string' && bio.trim().length > 0) {
        bioByUsername.set(normalized, bio);
      }
    }
  }

  console.log(`Resolved ${bioByUserId.size} bios by userId, ${bioByUsername.size} by username.`);

  // 3. Plan updates per archive.
  type Plan = {
    archiveId: string;
    slug: string;
    showName: string;
    djUpdates: Array<{ index: number; djName: string; bioChars: number; via: 'userId' | 'username' }>;
  };
  const plans: Plan[] = [];
  let archivesAlreadyHaveBios = 0;
  let djsWithoutAnyMatch = 0;

  for (const doc of archivesSnap.docs) {
    const data = doc.data();
    const djs = (data.djs || []) as DJ[];
    const djUpdates: Plan['djUpdates'] = [];
    let allHaveBio = djs.length > 0;
    for (let i = 0; i < djs.length; i++) {
      const dj = djs[i];
      if (dj.bio) continue;
      allHaveBio = false;
      let bio: string | undefined;
      let via: 'userId' | 'username' | null = null;
      if (dj.userId && bioByUserId.has(dj.userId)) {
        bio = bioByUserId.get(dj.userId);
        via = 'userId';
      } else if (dj.username) {
        const normalized = dj.username.replace(/[\s-]+/g, '').toLowerCase();
        if (bioByUsername.has(normalized)) {
          bio = bioByUsername.get(normalized);
          via = 'username';
        }
      }
      if (bio && via) {
        djUpdates.push({ index: i, djName: dj.name || '(no name)', bioChars: bio.length, via });
      } else {
        djsWithoutAnyMatch++;
      }
    }
    if (allHaveBio) archivesAlreadyHaveBios++;
    if (djUpdates.length > 0) {
      plans.push({
        archiveId: doc.id,
        slug: data.slug,
        showName: data.showName,
        djUpdates,
      });
    }
  }

  // 4. Print summary
  console.log(`\n=== Summary ===`);
  console.log(`Archives with all DJs already having bio:      ${archivesAlreadyHaveBios}`);
  console.log(`Archives needing 1+ bio update:                ${plans.length}`);
  console.log(`DJs in archives we can't find a bio for:        ${djsWithoutAnyMatch}`);
  const totalDjsToUpdate = plans.reduce((sum, p) => sum + p.djUpdates.length, 0);
  console.log(`Total DJ records to update:                     ${totalDjsToUpdate}`);

  // 5. Write plan log
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = `/tmp/archive-djbio-backfill-${ts}`;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/plan.json`, JSON.stringify(plans, null, 2));
  console.log(`Plan written to ${outDir}/plan.json`);

  if (!EXECUTE) {
    console.log(`\nDry-run only. Re-run with --execute to apply.`);
    return;
  }

  // 6. Execute. Update each archive's djs[] in place.
  console.log(`\n=== Executing ===`);
  let written = 0;
  for (const plan of plans) {
    const ref = db.collection('archives').doc(plan.archiveId);
    // Read fresh to avoid clobbering anything written between plan + execute.
    const snap = await ref.get();
    const data = snap.data();
    if (!data) continue;
    const djs = (data.djs || []) as DJ[];
    let mutated = false;
    for (const update of plan.djUpdates) {
      const dj = djs[update.index];
      if (!dj || dj.bio) continue; // racing change protection
      let bio: string | undefined;
      if (update.via === 'userId' && dj.userId) bio = bioByUserId.get(dj.userId);
      else if (update.via === 'username' && dj.username) {
        bio = bioByUsername.get(dj.username.replace(/[\s-]+/g, '').toLowerCase());
      }
      if (bio) {
        djs[update.index] = { ...dj, bio };
        mutated = true;
      }
    }
    if (mutated) {
      await ref.update({ djs });
      written++;
      if (written % 25 === 0) console.log(`  …${written}/${plans.length}`);
    }
  }
  console.log(`Done. ${written} archive docs updated.`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
