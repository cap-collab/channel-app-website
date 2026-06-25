/**
 * REUSABLE loop surgery (keep this script). Two operations on a FUTURE,
 * not-yet-playing archive-radio loop, both offset-safe via reflowOffsets:
 *
 *   1. PREPEND gap-fill — add one archive + one interlude at the FRONT and move
 *      startTimeMs back by exactly the span they add, so the loop starts at/before
 *      the previous loop's end (no gap). Because everything after the prepended
 *      block keeps its EXACT absolute timing, any existing anchors are preserved.
 *
 *   2. ANCHOR splice — cut the archive playing across an anchor's start short,
 *      insert the toilet-therapist hand-back interlude, then the anchored archive,
 *      so the anchored archive becomes audible exactly at the anchor start.
 *
 * WHY hand-edit instead of regenerate: the generator can't place a 2nd anchor in
 * one loop yet, and the cron self-heal skips an already-anchored loop
 * (planReason 'anchor' + alignedAnchorCount>0). This is the manual path until the
 * multi-anchor generator work lands (see memory project_archive_radio_multi_anchor).
 *
 * SAFE only on a future loop (refuses if playing/past/locked). Dry-run by default;
 * pass --commit to write Firestore.
 *
 * Configured below for loop-0031: prepend gap-fill + 8 PM "featuring danyo" anchor.
 * To reuse: change LOOP_DOC / the ANCHORS list / PREPEND flag. Verified zero-drift
 * 2026-06-25.
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { getAdminDb } from '../src/lib/firebase-admin';
import { reflowOffsets } from '../src/lib/archive-schedule';
import { Timestamp } from 'firebase-admin/firestore';

// ─────────────────────────── CONFIG ───────────────────────────
const LOOP_DOC = 'loop-0031';
const PREV_LOOP_DOC = 'loop-0030';      // to compute the gap; null to skip gap-fill
const DO_PREPEND_GAPFILL = true;        // close the loop's start gap by prepending
const TT_ID = 'mGUjchuXuFAtTa4dmAls';   // toilet-therapist hand-back interlude

// Anchors to splice in (anchored archive must become audible at startZ).
const ANCHORS = [
  { label: '8 PM danyo', startZ: '2026-06-27T03:00:00Z', archiveId: 'kCX6JeJPXLvI1irMQ8b3' },
];

// Prepend filler: a real archive to put in front (reuse is fine for radio).
// Default null = auto-pick a high-priority archive already in the loop's tail.
const PREPEND_ARCHIVE_ID: string | null = null;
// ───────────────────────────────────────────────────────────────

const CROSSFADE = 5;
const fmt = (ms: number) => new Date(ms).toISOString().slice(11, 23) + 'Z';

type Item = {
  kind: 'archive' | 'interstitial';
  recordingUrl: string;
  durationSec: number;
  startOffsetSec: number;
  archiveId?: string;
  interstitialId?: string;
  title?: string;
  djs?: Array<Record<string, unknown>>;
  artworkUrl?: string;
  sceneSlugs?: string[];
};

const trimDjs = (djs: Array<Record<string, unknown>> | undefined) =>
  djs?.map((d) => {
    const o: Record<string, unknown> = { name: d.name };
    if (d.username) o.username = d.username;
    if (d.photoUrl) o.photoUrl = d.photoUrl;
    return o;
  });

async function archiveItem(db: FirebaseFirestore.Firestore, id: string): Promise<Item> {
  const a = (await db.collection('archives').doc(id).get()).data();
  if (!a) throw new Error(`archive ${id} not found`);
  return {
    kind: 'archive', recordingUrl: a.recordingUrl as string, durationSec: Number(a.duration ?? a.durationSec),
    startOffsetSec: 0, archiveId: id, title: a.showName as string,
    djs: trimDjs(a.djs as Array<Record<string, unknown>>), artworkUrl: a.showImageUrl as string,
    sceneSlugs: a.sceneSlugs as string[] | undefined,
  };
}

async function main() {
  const commit = process.argv.includes('--commit');
  const db = getAdminDb();
  if (!db) { console.error('no db'); process.exit(1); }

  const ref = db.collection('archive-radio-loop').doc(LOOP_DOC);
  const data = (await ref.get()).data();
  if (!data) { console.error(`${LOOP_DOC} not found`); process.exit(1); }
  let startMs = Number(data.startTimeMs);
  const items = (data.items as Item[]).map((it) => ({ ...it }));

  const now = Date.now();
  if (startMs <= now) { console.error('REFUSING: loop is playing/past'); process.exit(1); }
  if (data.locked === true) { console.error('REFUSING: loop is locked'); process.exit(1); }

  // toilet-therapist real fields (reuse an existing one in the loop, else interstitials coll).
  const ttSample = items.find((it) => it.interstitialId === TT_ID);
  const ttDur = ttSample ? ttSample.durationSec : 23;
  const ttUrl = ttSample ? ttSample.recordingUrl
    : (await db.collection('interstitials').doc(TT_ID).get()).data()?.url ?? '';
  const ttItem = (): Item => ({ kind: 'interstitial', recordingUrl: ttUrl, durationSec: ttDur, startOffsetSec: 0, interstitialId: TT_ID, title: 'toilet therapist' });

  // Record existing anchor hand-back absolute times so we can verify they don't move.
  const handbackAbs = items.filter((it) => it.interstitialId === TT_ID).map((it) => startMs + it.startOffsetSec * 1000);

  // ── (2) ANCHOR splices first (by absolute time; unaffected by a later prepend) ──
  for (const anc of ANCHORS) {
    const tMs = Date.parse(anc.startZ);
    const abs = (it: Item) => startMs + it.startOffsetSec * 1000;
    const end = (it: Item) => abs(it) + it.durationSec * 1000;
    const idx = items.findIndex((it) => it.kind === 'archive' && abs(it) <= tMs && tMs < end(it));
    if (idx < 0) { console.error(`REFUSING: no archive covers anchor "${anc.label}" @ ${anc.startZ}`); process.exit(1); }
    const cut = items[idx];
    const interludeAudible = tMs - (ttDur - CROSSFADE) * 1000;
    const cutAudibleEnd = interludeAudible + CROSSFADE * 1000;
    const cutTruncSec = Math.round((cutAudibleEnd - abs(cut)) * 0.001);
    if (cutTruncSec < 30) { console.error(`REFUSING: cut for "${anc.label}" would be ${cutTruncSec}s (<30s)`); process.exit(1); }
    const danyo = await archiveItem(db, anc.archiveId);
    console.log(`[anchor ${anc.label}] cut "${cut.title}" ${cut.durationSec}s → ${cutTruncSec}s; insert TT(${ttDur}s) + "${danyo.title}"(${danyo.durationSec}s) @ ${anc.startZ}`);
    items[idx] = { ...cut, durationSec: cutTruncSec };
    items.splice(idx + 1, 0, ttItem(), danyo);
  }

  // ── (1) PREPEND gap-fill ──
  if (DO_PREPEND_GAPFILL && PREV_LOOP_DOC) {
    const prev = (await db.collection('archive-radio-loop').doc(PREV_LOOP_DOC).get()).data();
    if (!prev) { console.error(`${PREV_LOOP_DOC} not found`); process.exit(1); }
    const prevEnd = Number(prev.startTimeMs) + Number(prev.totalDurationSec) * 1000;
    const gapMs = startMs - prevEnd;
    if (gapMs <= 0) {
      console.log(`[prepend] no gap (loop starts ${(-gapMs / 60000).toFixed(1)}min before prev end) — skipping`);
    } else {
      // Pick a filler archive: configured, else a high-priority archive from the loop tail.
      let fillerId = PREPEND_ARCHIVE_ID;
      if (!fillerId) {
        const tail = items.filter((it) => it.kind === 'archive' && it.archiveId).slice(-10);
        fillerId = tail[0]?.archiveId ?? items.find((it) => it.kind === 'archive')!.archiveId!;
      }
      const filler = await archiveItem(db, fillerId);
      // Span the [archive, interlude] pair adds in front of the old first item:
      const addedSpanSec = (filler.durationSec - CROSSFADE) + (ttItem().durationSec - CROSSFADE);
      const L = addedSpanSec * 1000;
      const newStart = startMs - L;
      console.log(`[prepend] gap ${(gapMs / 60000).toFixed(1)}min; prepend "${filler.title}"(${filler.durationSec}s)+TT adds ${(addedSpanSec / 60).toFixed(1)}min; newStart ${fmt(newStart)} (seam ${((newStart - prevEnd) / 60000).toFixed(1)}min ${newStart <= prevEnd ? '✅' : '❌ STILL GAP'})`);
      if (newStart > prevEnd) { console.error('REFUSING: one filler archive does not close the gap'); process.exit(1); }
      items.unshift(filler, ttItem());
      startMs = newStart;
    }
  }

  // ── Re-flow ALL offsets (canonical 5s-crossfade pass) ──
  reflowOffsets(items as Parameters<typeof reflowOffsets>[0]);

  // ── Truncate the TAIL so the loop ends in the 3-4am PT window (10-11 UTC). ──
  // Adding a long anchor archive lengthens the loop; without this it would end at
  // a random (peak) hour. Drop whole trailing items until the natural end lands
  // at/before the last 3-4am PT window. Guard: never drop an anchored archive,
  // its hand-back interlude, or anything before them (anchors are fixed points).
  const END_HOUR_LO = 10; // 3am PT (3:30 mid)
  const prevWindowMidMs = (beforeMs: number, hourLo: number) => {
    const day = new Date(beforeMs); day.setUTCHours(0, 0, 0, 0);
    for (let d = 1; d >= -6; d--) {
      const mid = day.getTime() + d * 86_400_000 + (hourLo + 0.5) * 3600 * 1000;
      if (mid <= beforeMs) return mid;
    }
    return -Infinity;
  };
  // Last index we must NOT drop past = the last anchored archive's hand-back interlude.
  const anchorIds = new Set(ANCHORS.map((a) => a.archiveId));
  let lastProtectedIdx = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].archiveId && anchorIds.has(items[i].archiveId!)) lastProtectedIdx = Math.max(lastProtectedIdx, i);
  }
  // Target the UPPER edge of the 3-4am PT window (4am = 11 UTC) so the final end
  // lands INSIDE [3am,4am] rather than overshooting below 3am: drop trailing items
  // until the last item's end is at/before the last 4am PT. (Dropping is whole-item
  // granular, so stopping at the 4am edge keeps the end as late as possible, in-window.)
  const naturalEnd0 = startMs + (items[items.length - 1].startOffsetSec + items[items.length - 1].durationSec) * 1000;
  const endTarget = prevWindowMidMs(naturalEnd0, END_HOUR_LO + 1) - 1800 * 1000; // 4:00am PT exactly
  let dropped = 0;
  while (items.length - 1 > lastProtectedIdx) {
    const last = items[items.length - 1];
    const lastEnd = startMs + (last.startOffsetSec + last.durationSec) * 1000;
    if (lastEnd <= endTarget) break;
    items.pop();
    dropped++;
  }
  const totalDurationSec = reflowOffsets(items as Parameters<typeof reflowOffsets>[0]);
  const finalEnd = startMs + totalDurationSec * 1000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const ptT = (ms: number) => new Date(ms - 7 * 3600_000).toISOString().slice(11, 16) + ' PT';
  console.log(`[truncate] target end ${iso(endTarget)} (${ptT(endTarget)}); dropped ${dropped} tail item(s); final end ${iso(finalEnd)} (${ptT(finalEnd)})`);

  // Verify: each anchor lands at its start, and pre-existing hand-backs keep absolute time.
  let bad = false;
  for (const anc of ANCHORS) {
    const tMs = Date.parse(anc.startZ);
    const it = items.find((x) => x.archiveId === anc.archiveId);
    const landAbs = startMs + (it ? it.startOffsetSec : 0) * 1000;
    const drift = (landAbs - tMs) / 1000;
    console.log(`  verify anchor ${anc.label}: audible ${fmt(landAbs)} (drift ${drift.toFixed(1)}s)`);
    if (Math.abs(drift) > 2) bad = true;
  }
  // The pre-existing hand-backs (the original anchor set) should be unchanged in absolute time.
  const newHandbackAbs = items.filter((it) => it.interstitialId === TT_ID).map((it) => startMs + it.startOffsetSec * 1000);
  for (const old of handbackAbs) {
    const match = newHandbackAbs.find((n) => Math.abs(n - old) < 2000);
    console.log(`  verify existing hand-back ${fmt(old)}: ${match ? '✅ unchanged' : '⚠️ shifted/none'}`);
  }

  console.log(`\nitems ${data.items.length} → ${items.length}; total ${(Number(data.totalDurationSec) / 3600).toFixed(2)}h → ${(totalDurationSec / 3600).toFixed(2)}h; start ${fmt(Number(data.startTimeMs))} → ${fmt(startMs)}`);

  if (bad) { console.error('\nREFUSING: an anchor drift > 2s — not writing'); process.exit(1); }
  if (!commit) { console.log('\n[DRY RUN] no write. Re-run with --commit.'); return; }

  const clean = items.map((it) => JSON.parse(JSON.stringify(it)));
  await ref.update({
    items: clean,
    totalDurationSec,
    startTime: Timestamp.fromMillis(startMs),
    startTimeMs: startMs,
    generatedBy: 'admin',
    handEditedAt: Timestamp.fromMillis(now),
    handEditNote: `loop surgery (prepend gap-fill + anchor splice) ${new Date(now).toISOString().slice(0, 10)}`,
  });
  console.log(`\n✅ WROTE ${LOOP_DOC}.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
