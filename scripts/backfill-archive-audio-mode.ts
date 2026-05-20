/**
 * One-time backfill of archives[].audioMode (mono | stereo | null).
 *
 * Detection is delegated to the restream-worker's /probe endpoint — the SAME
 * code the live archive-creation path uses — so there is a single source of
 * truth for the mono/stereo logic. This script never runs ffprobe itself.
 *
 * audioMode drives restream encoding: a 'mono' archive is published as a
 * genuine 1-channel Opus track so stereo RED redundancy can't bleed. null
 * (inconclusive / unreadable) ⇒ restreams fall back to stereo.
 *
 * Dry-run by default — prints a plan + summary, writes plan.json, no Firestore
 * writes. Re-run with --execute to apply. Only archives WITHOUT an audioMode
 * are touched (already-set values, incl. admin corrections, are left alone).
 *
 * Before the full run, validate detection against known cases:
 *   npx tsx -r tsconfig-paths/register scripts/backfill-archive-audio-mode.ts --slug protectynggirls
 * Compare the verdict in plan.json against the known-correct label.
 *
 * Run:
 *   npx tsx -r tsconfig-paths/register scripts/backfill-archive-audio-mode.ts
 *   npx tsx -r tsconfig-paths/register scripts/backfill-archive-audio-mode.ts --execute
 *   npx tsx -r tsconfig-paths/register scripts/backfill-archive-audio-mode.ts --slug <slug>
 *   npx tsx -r tsconfig-paths/register scripts/backfill-archive-audio-mode.ts --archive-id <id>
 *
 * Requires RESTREAM_WORKER_URL + CRON_SECRET in the environment (the worker's
 * SHARED_SECRET). Pre-flight `gcloud auth application-default login` for
 * Firestore admin access.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { writeFileSync, mkdirSync } from 'fs';
import { getAdminDb } from '../src/lib/firebase-admin';

const EXECUTE = process.argv.includes('--execute');

// Optional subset filters — used for the detection-accuracy check before the
// full catalog run.
function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const SLUG_FILTER = flagValue('--slug');
const ARCHIVE_ID_FILTER = flagValue('--archive-id');

const WORKER_URL = process.env.RESTREAM_WORKER_URL;
const WORKER_SECRET = process.env.CRON_SECRET;

type ProbeResult = {
  channels: number | null;
  separationDb: number | null;
  audioMode: 'mono' | 'stereo' | null;
};

/** Probe one archive via the restream-worker. Returns audioMode=null on any failure. */
async function probe(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(`${WORKER_URL}/probe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WORKER_SECRET}`,
      },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as ProbeResult;
    if (!res.ok) {
      console.warn(`  probe HTTP ${res.status} for ${url}`);
      return { channels: null, separationDb: null, audioMode: null };
    }
    return {
      channels: data.channels ?? null,
      separationDb: data.separationDb ?? null,
      audioMode:
        data.audioMode === 'mono' || data.audioMode === 'stereo' ? data.audioMode : null,
    };
  } catch (err) {
    console.warn(`  probe error for ${url}:`, err instanceof Error ? err.message : err);
    return { channels: null, separationDb: null, audioMode: null };
  }
}

async function main() {
  if (!WORKER_URL || !WORKER_SECRET) {
    throw new Error('RESTREAM_WORKER_URL and CRON_SECRET must be set in the environment');
  }
  const db = getAdminDb();
  if (!db) throw new Error('Firestore admin not configured');

  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  if (SLUG_FILTER) console.log(`Filter: slug == "${SLUG_FILTER}"`);
  if (ARCHIVE_ID_FILTER) console.log(`Filter: archiveId == "${ARCHIVE_ID_FILTER}"`);

  // 1. Load archives. Only those without an audioMode are candidates —
  //    already-set values (incl. admin corrections) are never overwritten.
  const archivesSnap = await db.collection('archives').get();
  console.log(`Loaded ${archivesSnap.size} archives.`);

  const candidates = archivesSnap.docs.filter((doc) => {
    const data = doc.data();
    if (ARCHIVE_ID_FILTER && doc.id !== ARCHIVE_ID_FILTER) return false;
    if (SLUG_FILTER && data.slug !== SLUG_FILTER) return false;
    // Missing or null ⇒ needs backfill. 'mono'/'stereo' ⇒ already set, skip.
    return data.audioMode !== 'mono' && data.audioMode !== 'stereo';
  });
  console.log(`${candidates.length} archive(s) need an audioMode.`);

  // 2. Probe each candidate (sequentially — the worker handles one ffprobe job
  //    at a time, and this is a one-time run so throughput isn't a concern).
  type Plan = {
    archiveId: string;
    slug: string;
    showName: string;
    recordingUrl: string;
    channels: number | null;
    separationDb: number | null;
    audioMode: 'mono' | 'stereo' | null;
  };
  const plans: Plan[] = [];
  let noUrl = 0;

  for (let i = 0; i < candidates.length; i++) {
    const doc = candidates[i];
    const data = doc.data();
    const recordingUrl = data.recordingUrl as string | undefined;
    if (!recordingUrl) {
      noUrl++;
      continue;
    }
    process.stdout.write(`[${i + 1}/${candidates.length}] ${data.slug} … `);
    const result = await probe(recordingUrl);
    console.log(
      `${result.audioMode ?? 'null'} (channels=${result.channels}, separation=${result.separationDb}dB)`,
    );
    plans.push({
      archiveId: doc.id,
      slug: data.slug,
      showName: data.showName,
      recordingUrl,
      channels: result.channels,
      separationDb: result.separationDb,
      audioMode: result.audioMode,
    });
  }

  // 3. Summary — eyeball the distribution. All-mono or all-stereo is a red flag.
  const mono = plans.filter((p) => p.audioMode === 'mono').length;
  const stereo = plans.filter((p) => p.audioMode === 'stereo').length;
  const inconclusive = plans.filter((p) => p.audioMode === null).length;
  console.log(`\n=== Summary ===`);
  console.log(`Probed:             ${plans.length}`);
  console.log(`  → mono:           ${mono}`);
  console.log(`  → stereo:         ${stereo}`);
  console.log(`  → inconclusive:   ${inconclusive} (stored as null → restream as stereo)`);
  console.log(`Skipped (no URL):   ${noUrl}`);

  // 4. Write plan log.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = `/tmp/archive-audio-mode-backfill-${ts}`;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/plan.json`, JSON.stringify(plans, null, 2));
  console.log(`Plan written to ${outDir}/plan.json`);

  if (!EXECUTE) {
    console.log(`\nDry-run only. Review plan.json, then re-run with --execute to apply.`);
    return;
  }

  // 5. Execute. Write audioMode (incl. null for inconclusive — that records
  //    "we probed and couldn't tell", distinct from "never probed").
  console.log(`\n=== Executing ===`);
  let written = 0;
  for (const plan of plans) {
    const ref = db.collection('archives').doc(plan.archiveId);
    // Read fresh — skip if an admin set audioMode between plan and execute.
    const snap = await ref.get();
    const data = snap.data();
    if (!data) continue;
    if (data.audioMode === 'mono' || data.audioMode === 'stereo') {
      console.log(`  skip ${plan.slug}: audioMode set to "${data.audioMode}" since plan was built`);
      continue;
    }
    await ref.update({ audioMode: plan.audioMode });
    written++;
    if (written % 25 === 0) console.log(`  …${written}/${plans.length}`);
  }
  console.log(`Done. ${written} archive docs updated.`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
