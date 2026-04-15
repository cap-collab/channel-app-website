/**
 * R2 cleanup — explicit delete list + live-reference guard.
 *
 * You paste the keys to delete into DELETE_LIST below.
 * The script:
 *   1. Loads all live references from Firestore (archives + broadcast-slots).
 *   2. For each key in DELETE_LIST: if it's referenced anywhere live, ABORT.
 *   3. Dry-run prints the plan + sha256. Execute requires --confirm-token=<sha>.
 *   4. Logs every action to /tmp/r2-cleanup-<ts>/log.jsonl
 *
 * USAGE:
 *   Dry-run:  npx tsx scripts/cleanup-r2-recordings.ts
 *   Execute:  npx tsx scripts/cleanup-r2-recordings.ts --execute --confirm-token=<sha>
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { S3Client, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, ListObjectsV2CommandOutput, _Object } from '@aws-sdk/client-s3';
import { writeFileSync, appendFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { getAdminDb } from '../src/lib/firebase-admin';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!.replace(/\\n/g, '').trim();
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID!.replace(/\\n/g, '').trim();
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY!.replace(/\\n/g, '').trim();
const R2_BUCKET = process.env.R2_BUCKET_NAME!.replace(/\\n/g, '').trim();
const R2_PUBLIC = process.env.R2_PUBLIC_URL!.replace(/\\n/g, '').trim().replace(/\/$/, '');

// ─────────────────────────────────────────────────────────────────────────────
// EXPLICIT DELETE LIST — regenerate with:
//   awk -F'","' 'NR>1 && ($1=="\"ORPHAN" || $1=="\"HLS_SEGMENT"){gsub(/"/,""); print $2}' \
//     /tmp/r2-audit-*/audit.csv | sort -u
// Keep this list narrow and review it before running.
// ─────────────────────────────────────────────────────────────────────────────
const DELETE_LIST: string[] = [
  // --- ORPHAN: egress manifests (all tiny json) ---
  'channel-radio/EG_RzySuZYkq9kN.json',
  'channel-radio/EG_yyc4anjQ4FZN.json',
  'recordings/channel-radio/EG_AsJBLd7aFkxs.json',
  'recordings/channel-radio/EG_BT2i768S6Moj.json',
  'recordings/channel-radio/EG_Csmr5tp5VhYe.json',
  'recordings/channel-radio/EG_KACTrpNseVdh.json',
  'recordings/channel-radio/EG_QoJi7QzUX7zf.json',
  'recordings/channel-radio/EG_RSVCMvoybZtk.json',
  'recordings/channel-radio/EG_Rfk5rYGC42in.json',
  'recordings/channel-radio/EG_UNitrbHVTozn.json',
  'recordings/channel-radio/EG_VyLzr9eZ29hB.json',
  'recordings/channel-radio/EG_ZSAswpi5N876.json',
  'recordings/channel-radio/EG_bSCe89rvNQnx.json',
  'recordings/channel-radio/EG_cjEK3VYdCbwz.json',
  'recordings/channel-radio/EG_dLtGb5kSknGR.json',
  'recordings/channel-radio/EG_e8vJzCK5BdBr.json',
  'recordings/channel-radio/EG_fFAPrbE4FGRD.json',
  'recordings/channel-radio/EG_gMNjHTPXSMRS.json',
  'recordings/channel-radio/EG_gv5hrEq3iNVv.json',
  'recordings/channel-radio/EG_hbmjLkoRYQKy.json',
  'recordings/channel-radio/EG_kNG8nBMv82N3.json',
  'recordings/channel-radio/EG_maS4ZQmAYrmS.json',
  'recordings/channel-radio/EG_ose27fXpFNJ6.json',
  'recordings/channel-radio/EG_pg9tFcryh5fQ.json',
  'recordings/channel-radio/EG_qkNsBnnvK4qQ.json',
  'recordings/channel-radio/EG_sQmVpRtfvxZE.json',
  'recordings/channel-radio/EG_wwW3bduSZC2m.json',
  'recordings/channel-radio/EG_yeiu6WBwFwCh.json',
  'recordings/channel-radio/EG_zfKkvwRVKBiM.json',
  'recordings/recording-AglYfAEiVOZ3IZkChSG42X1MbWH3-1775696886813/EG_oFehxNSkp95s.json',
  'recordings/recording-AglYfAEiVOZ3IZkChSG42X1MbWH3-1775696956492/EG_QcK9suGvwHVA.json',
  'recordings/recording-QjZufsahaRbOKk586nlkuauiaFK2-1775761708667/EG_x7cHV9MjPBVU.json',
  'recordings/recording-QjZufsahaRbOKk586nlkuauiaFK2-1775765599601/EG_C5W6LyLUy5a6.json',
  'recordings/recording-QjZufsahaRbOKk586nlkuauiaFK2-1775765867355/EG_PNpEemB6CrVn.json',
  'recordings/recording-axpIMUwbOpZ0O3sAzsn6H1bGy6C3-1775704203231/EG_CHxWUm5Yws2e.json',
  'recordings/recording-axpIMUwbOpZ0O3sAzsn6H1bGy6C3-1775704378341/EG_bih5TtRiui4o.json',
  'recordings/recording-axpIMUwbOpZ0O3sAzsn6H1bGy6C3-1775704665461/EG_S6Y8GEQZ4Tiv.json',
  'recordings/recording-axpIMUwbOpZ0O3sAzsn6H1bGy6C3-1775705157048/EG_HvrogJvTZbFH.json',
  'recordings/recording-gjzo1XiiikbewxITQ1zCsSyAjY02-1775839658294/EG_PHpZp36JxdJg.json',

  // --- ORPHAN: test-room leftovers ---
  'test-room/EG_2PzchJmR46Jz.json',
  'test-room/EG_4Uy7A7bxkkYz.json',
  'test-room/EG_AUCYELs8kH3i.json',
  'test-room/EG_nnEBf8cZJqr9.json',

  // --- ORPHAN: aborted/failed channel-radio broadcasts (all < 10 MB, no archive doc) ---
  'recordings/channel-radio/channel-radio-2026-04-09T030504.mp4',
  'recordings/channel-radio/channel-radio-2026-04-13T030515-normalized-v1.mp4',
  'recordings/channel-radio/channel-radio-2026-04-13T030515.mp4',
  'recordings/channel-radio/channel-radio-2026-04-13T033304-normalized-v1.mp4',
  'recordings/channel-radio/channel-radio-2026-04-13T033304.mp4',
  'recordings/channel-radio/channel-radio-2026-04-13T034326.mp4',
  'recordings/channel-radio/channel-radio-2026-04-13T034553.mp4',
  'recordings/channel-radio/channel-radio-2026-04-13T041639.mp4',
  'recordings/channel-radio/channel-radio-2026-04-13T042245.mp4',
  'recordings/channel-radio/channel-radio-2026-04-14T185829.mp4',
  'recordings/channel-radio/channel-radio-2026-04-15T132010.mp4',

  // --- ORPHAN: aborted user-specific recordings ---
  'recordings/recording-AglYfAEiVOZ3IZkChSG42X1MbWH3-1775696886813/recording-AglYfAEiVOZ3IZkChSG42X1MbWH3-1775696886813-2026-04-09T010809.mp4',
  'recordings/recording-AglYfAEiVOZ3IZkChSG42X1MbWH3-1775696956492/recording-AglYfAEiVOZ3IZkChSG42X1MbWH3-1775696956492-2026-04-09T010918.mp4',
  'recordings/recording-QjZufsahaRbOKk586nlkuauiaFK2-1775761708667/recording-QjZufsahaRbOKk586nlkuauiaFK2-1775761708667-2026-04-09T190831.mp4',
  'recordings/recording-QjZufsahaRbOKk586nlkuauiaFK2-1775765599601/recording-QjZufsahaRbOKk586nlkuauiaFK2-1775765599601-2026-04-09T201323.mp4',
  'recordings/recording-QjZufsahaRbOKk586nlkuauiaFK2-1775765867355/recording-QjZufsahaRbOKk586nlkuauiaFK2-1775765867355-2026-04-09T201750.mp4',
  'recordings/recording-axpIMUwbOpZ0O3sAzsn6H1bGy6C3-1775704203231/recording-axpIMUwbOpZ0O3sAzsn6H1bGy6C3-1775704203231-2026-04-09T031006.mp4',
  'recordings/recording-axpIMUwbOpZ0O3sAzsn6H1bGy6C3-1775704378341/recording-axpIMUwbOpZ0O3sAzsn6H1bGy6C3-1775704378341-2026-04-09T031301.mp4',
  'recordings/recording-gjzo1XiiikbewxITQ1zCsSyAjY02-1775839658294/recording-gjzo1XiiikbewxITQ1zCsSyAjY02-1775839658294-2026-04-10T164741.mp4',

];

// HLS fragments (.ts / .m3u8) loaded from sidecar file — there are ~1400 so we
// keep them out of this file. Regenerate with:
//   python3 -c "import json; d=json.load(open('/tmp/r2-cleanup-XXX/keep-summary.json')); \
//     open('scripts/cleanup-r2-hls-keys.txt','w').write('\n'.join(sorted(x['key'] for x in d['keepOther']))+'\n')"
const HLS_KEYS_FILE = join(__dirname, 'cleanup-r2-hls-keys.txt');
const HLS_KEYS: string[] = existsSync(HLS_KEYS_FILE)
  ? readFileSync(HLS_KEYS_FILE, 'utf-8').split('\n').filter(Boolean)
  : [];
// Safety: HLS sidecar must only contain .ts or .m3u8 under known prefixes.
const HLS_ALLOWED = /^(channel-radio|channel-radio-restream|test-room)\/.+\.(ts|m3u8)$/;
for (const k of HLS_KEYS) {
  if (!HLS_ALLOWED.test(k)) {
    console.error(`❌ HLS sidecar contains unexpected key: ${k}`);
    process.exit(10);
  }
}
DELETE_LIST.push(...HLS_KEYS);

function keyFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith(R2_PUBLIC + '/')) return url.slice(R2_PUBLIC.length + 1);
  const m = url.match(/^https?:\/\/[^/]+\/(.+)$/);
  return m ? m[1] : null;
}

async function loadProtectedKeys(): Promise<Map<string, string>> {
  const db = getAdminDb()!;
  const sources = new Map<string, string>();
  const add = (k: string | null, source: string) => {
    if (k && !sources.has(k)) sources.set(k, source);
  };

  const archSnap = await db.collection('archives').get();
  for (const doc of archSnap.docs) {
    const d = doc.data();
    add(keyFromUrl(d.recordingUrl || ''), `archives/${doc.id}.recordingUrl`);
    add(keyFromUrl(d.previousRecordingUrl || ''), `archives/${doc.id}.previousRecordingUrl`);
  }

  try {
    const slotsSnap = await db.collection('broadcast-slots').get();
    for (const doc of slotsSnap.docs) {
      const d = doc.data();
      if (Array.isArray(d.recordings)) {
        for (const r of d.recordings) add(keyFromUrl(r?.url || ''), `broadcast-slots/${doc.id}.recordings[].url`);
      }
      add(keyFromUrl(d.recordingUrl || ''), `broadcast-slots/${doc.id}.recordingUrl`);
    }
  } catch (e) {
    console.warn('broadcast-slots scan failed:', (e as Error).message);
  }

  return sources;
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    execute: args.includes('--execute'),
    confirmToken: args.find((a) => a.startsWith('--confirm-token='))?.split('=')[1],
  };
}

async function main() {
  const { execute, confirmToken } = parseArgs();
  const ts = Date.now();
  const outDir = `/tmp/r2-cleanup-${ts}`;
  mkdirSync(outDir, { recursive: true });
  const logPath = `${outDir}/log.jsonl`;
  const log = (o: unknown) => appendFileSync(logPath, JSON.stringify(o) + '\n');

  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`Bucket: ${R2_BUCKET}`);
  console.log(`Candidates in DELETE_LIST: ${DELETE_LIST.length}`);
  console.log(`Output: ${outDir}`);

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  });

  // Deduplicate
  const unique = Array.from(new Set(DELETE_LIST));
  if (unique.length !== DELETE_LIST.length) {
    console.warn(`⚠️  Removed ${DELETE_LIST.length - unique.length} duplicates`);
  }

  console.log('\n[1/3] Loading Firestore live references…');
  const protectedSources = await loadProtectedKeys();
  console.log(`  ${protectedSources.size} protected keys`);

  console.log('[2a/3] Listing all R2 objects for keep-list summary…');
  const allObjects: _Object[] = [];
  let ContinuationToken: string | undefined = undefined;
  do {
    const out: ListObjectsV2CommandOutput = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, ContinuationToken, MaxKeys: 1000 }));
    if (out.Contents) allObjects.push(...out.Contents);
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);

  const deleteSet = new Set(unique);
  const keepProtected: _Object[] = [];
  const keepOther: _Object[] = [];
  for (const obj of allObjects) {
    const k = obj.Key!;
    if (deleteSet.has(k)) continue;
    if (protectedSources.has(k)) keepProtected.push(obj);
    else keepOther.push(obj);
  }

  console.log(`  total in R2: ${allObjects.length}`);
  console.log(`  will delete: ${deleteSet.size}`);
  console.log(`  will keep (Firestore-referenced): ${keepProtected.length}`);
  console.log(`  will keep (not referenced, not in delete list): ${keepOther.length}`);

  console.log('\n  KEEP — Firestore-referenced (live on /radio or rollback):');
  for (const obj of keepProtected.sort((a, b) => (b.Size || 0) - (a.Size || 0))) {
    const k = obj.Key!;
    const mb = ((obj.Size || 0) / 1024 / 1024).toFixed(1).padStart(7);
    console.log(`    ${mb} MB  ${k}  ← ${protectedSources.get(k)}`);
  }

  const keepOtherSize = keepOther.reduce((s, o) => s + (o.Size || 0), 0);
  console.log(`\n  KEEP — unreferenced but NOT in delete list (${keepOther.length} files, ${(keepOtherSize/1024/1024).toFixed(2)} MB):`);
  const keepOtherBig = keepOther.filter((o) => (o.Size || 0) > 100 * 1024);
  if (keepOtherBig.length === 0) {
    console.log('    (all <100 KB — HLS fragments and similar small artifacts)');
  } else {
    for (const obj of keepOtherBig.sort((a, b) => (b.Size || 0) - (a.Size || 0)).slice(0, 30)) {
      const mb = ((obj.Size || 0) / 1024 / 1024).toFixed(2).padStart(7);
      console.log(`    ${mb} MB  ${obj.Key}`);
    }
    if (keepOtherBig.length > 30) console.log(`    … and ${keepOtherBig.length - 30} more >100 KB`);
  }

  writeFileSync(
    `${outDir}/keep-summary.json`,
    JSON.stringify({
      keepProtected: keepProtected.map((o) => ({ key: o.Key, size: o.Size, ref: protectedSources.get(o.Key!) })),
      keepOther: keepOther.map((o) => ({ key: o.Key, size: o.Size })),
    }, null, 2)
  );
  console.log(`\n  Keep-list written: ${outDir}/keep-summary.json`);

  console.log('\n[2b/3] Checking DELETE_LIST against live references…');
  const conflicts = unique.filter((k) => protectedSources.has(k));
  if (conflicts.length > 0) {
    console.error(`\n❌ ABORT: ${conflicts.length} key(s) in DELETE_LIST are live in Firestore:`);
    for (const k of conflicts) console.error(`  ${k}  ← ${protectedSources.get(k)}`);
    writeFileSync(`${outDir}/conflicts.json`, JSON.stringify({ conflicts: conflicts.map((k) => ({ key: k, protectedBy: protectedSources.get(k) })) }, null, 2));
    process.exit(2);
  }
  console.log('  no conflicts — all candidates are safe to delete');

  // Plan hash from sorted keys
  const canonical = unique.slice().sort().join('\n');
  const planHash = createHash('sha256').update(canonical).digest('hex');

  writeFileSync(`${outDir}/plan.json`, JSON.stringify({ hash: planHash, count: unique.length, keys: unique.slice().sort() }, null, 2));
  console.log(`\n  Plan written: ${outDir}/plan.json`);
  console.log(`  Plan hash:    ${planHash}`);
  log({ event: 'plan-built', hash: planHash, count: unique.length });

  if (!execute) {
    console.log('\n[3/3] Dry-run complete. To execute:');
    console.log(`  npx tsx scripts/cleanup-r2-recordings.ts --execute --confirm-token=${planHash}`);
    return;
  }

  if (confirmToken !== planHash) {
    console.error(`\n❌ ABORT: --confirm-token mismatch.`);
    console.error(`  expected: ${planHash}`);
    console.error(`  got:      ${confirmToken || '(none)'}`);
    process.exit(4);
  }

  console.log(`\n[3/3] EXECUTING ${unique.length} deletions…`);
  let deleted = 0, skipped = 0, errors = 0;

  for (const key of unique) {
    // Re-verify at delete time: still not protected
    if (protectedSources.has(key)) {
      log({ event: 'skip', reason: 'protected-at-delete-time', key });
      skipped++;
      continue;
    }
    try {
      await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
      await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
      log({ event: 'deleted', key });
      deleted++;
      if (deleted % 20 === 0) console.log(`  deleted ${deleted}/${unique.length}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (/not found|NoSuchKey|404/i.test(msg)) {
        log({ event: 'skip', reason: 'not-found', key });
        skipped++;
      } else {
        log({ event: 'error', key, error: msg });
        errors++;
        console.error(`  ERROR on ${key}: ${msg}`);
      }
    }
  }

  console.log(`\nDone. deleted=${deleted} skipped=${skipped} errors=${errors}`);
  console.log(`Log: ${logPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
