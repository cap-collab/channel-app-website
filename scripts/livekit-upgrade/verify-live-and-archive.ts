/**
 * verify-live-and-archive.ts — RUN FROM YOUR MAC after a channelbroadcast test recording.
 * READ-ONLY. Deep-checks a test show end-to-end so we can see EXACTLY what the upgrade did:
 *   1. finds the most recent archive (or one by --id / --dj)
 *   2. prints the archive doc's recording fields (recordingUrl, previous/untrimmed, duration,
 *      recordingMethod, shortRecording) — the ARCHIVE-LOG check the recording→webhook pipeline writes
 *   3. downloads the RAW ORIGINAL (previousRecordingUrl) and runs silencedetect for the ~21ms
 *      10s-grid drops — the ground-truth "are the drops gone" check
 *   4. reports drop count + periodicity so you can compare pre/post upgrade
 *
 * Usage:
 *   npx tsx scripts/livekit-upgrade/verify-live-and-archive.ts            # newest archive
 *   npx tsx scripts/livekit-upgrade/verify-live-and-archive.ts --dj drench
 *   npx tsx scripts/livekit-upgrade/verify-live-and-archive.ts --id <archiveId>
 * Requires: .env.prod/.env.production (Firebase admin), ffmpeg on PATH.
 * THROWAWAY per house rule — kept here only for the multi-day upgrade test window.
 */
import '../lib/load-env';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

(async () => {
  const args = process.argv.slice(2);
  const idArg = args.includes('--id') ? args[args.indexOf('--id') + 1] : null;
  const djArg = args.includes('--dj') ? args[args.indexOf('--dj') + 1]?.toLowerCase() : null;

  if (!getApps().length) {
    const pk = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').includes('\\n')
      ? process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, '\n')
      : process.env.FIREBASE_ADMIN_PRIVATE_KEY!;
    initializeApp({ credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey: pk }) });
  }
  const db = getFirestore();
  const ms = (t: any) => t?._seconds ? new Date(t._seconds * 1000).toISOString() : (t?.toDate ? t.toDate().toISOString() : t);

  // 1. locate the archive
  let doc: any;
  if (idArg) {
    doc = await db.collection('archives').doc(idArg).get();
  } else {
    const snap = await db.collection('archives').orderBy('createdAt', 'desc').limit(40).get();
    const rows = snap.docs.filter(d => {
      if (!djArg) return true;
      return JSON.stringify([d.data().djs, d.data().djNames, d.data().title]).toLowerCase().includes(djArg);
    });
    doc = rows[0];
  }
  if (!doc || !doc.exists) { console.log('No matching archive found.'); process.exit(1); }
  const d = doc.data();

  // 2. ARCHIVE-LOG CHECK
  console.log('\n========== ARCHIVE DOC (what the recording->webhook pipeline wrote) ==========');
  console.log(`id=${doc.id}`);
  console.log(`  djs=${JSON.stringify((d.djs || d.djNames || []).map((x: any) => x?.name || x?.username || x))}`);
  console.log(`  created=${ms(d.createdAt)}  duration(sec)=${d.duration}`);
  console.log(`  recordingMethod=${d.recordingMethod ?? '(not stamped)'}   shortRecording=${d.shortRecording ?? '-'}`);
  console.log(`  recordingUrl=          ${d.recordingUrl}`);
  console.log(`  previousRecordingUrl=  ${d.previousRecordingUrl || '(none)'}`);
  console.log(`  untrimmedRecordingUrl= ${d.untrimmedRecordingUrl || '(none)'}`);
  // sanity flags
  if (d.shortRecording) console.log('  ⚠️ shortRecording flag SET — capture may have been dead/short.');
  if (!d.recordingUrl) console.log('  ⚠️ recordingUrl MISSING — archive created but no playable file.');

  // 3. pick the TRUE egress original to analyze. Priority: previousRecordingUrl (raw egress mp4)
  //    > untrimmedRecordingUrl (full normalized) > recordingUrl. BUT if the only thing available is
  //    an `upload-*` or a manually-swapped file, this is NOT an egress capture — analyzing it tells
  //    us nothing about the egress upgrade. Detect + refuse a false verdict.
  const isEgressCapture = (u?: string) => !!u && /channel-radio-\d{4}-\d{2}-\d{2}T/.test(u) && !/\/upload-/.test(u);
  const raw = [d.previousRecordingUrl, d.untrimmedRecordingUrl, d.recordingUrl].find(isEgressCapture)
            || d.previousRecordingUrl || d.recordingUrl;
  if (!raw) { console.log('\nNo raw file URL to analyze.'); process.exit(0); }
  if (!isEgressCapture(raw)) {
    console.log(`\n⚠️  The available file is NOT an egress capture (looks like a manual upload/replacement):`);
    console.log(`    ${raw}`);
    console.log(`    → A drop analysis here does NOT reflect the egress/upgrade. Use a FRESH channelbroadcast`);
    console.log(`      test recording whose previousRecordingUrl is a channel-radio-<ts>.mp4. Skipping verdict.`);
    process.exit(0);
  }
  const dir = mkdtempSync(join(tmpdir(), 'verify-'));
  const f = join(dir, 'raw.mp4');
  console.log(`\n========== AUDIO DROP CHECK (raw original) ==========`);
  console.log(`downloading ${raw} ...`);
  try {
    execSync(`curl -s --max-time 300 -o "${f}" "${raw}"`);
    const probe = execSync(`ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,channels -of default=noprint_wrappers=1 "${f}"`).toString().trim();
    console.log(`ffprobe: ${probe.replace(/\n/g, '  ')}`);
    // full-file silencedetect, parse silence_end (carries end+dur on one line)
    const out = execSync(
      `ffmpeg -hide_banner -nostats -i "${f}" -af "silencedetect=noise=-45dB:d=0.02" -f null - 2>&1 | grep silence_end || true`
    ).toString();
    const gaps: { t: number; dur: number }[] = [];
    for (const line of out.split('\n')) {
      const em = line.match(/silence_end:\s*([\d.]+)/);
      const dm = line.match(/silence_duration:\s*([\d.]+)/);
      if (em && dm) { const dur = parseFloat(dm[1]); gaps.push({ t: parseFloat(em[1]) - dur, dur }); }
    }
    const micro = gaps.filter(g => g.dur * 1000 >= 15 && g.dur * 1000 <= 35); // the ~21ms drop band
    console.log(`total silence events: ${gaps.length}   |   ~15-35ms micro-gaps (the drop signature): ${micro.length}`);
    // periodicity: are they on a ~10s grid? show mod-10 clustering + spacing histogram
    if (micro.length >= 3) {
      const mod10 = micro.map(g => +(g.t % 10).toFixed(1));
      const clustered = mod10.filter(m => Math.abs(m - median(mod10)) < 1).length;
      console.log(`  mod-10 phase median=${median(mod10)}s  (${clustered}/${micro.length} within 1s of it → ${clustered / micro.length > 0.5 ? 'PERIODIC (fixed-timer drops STILL PRESENT)' : 'scattered'})`);
      const spac: Record<string, number> = {};
      for (let i = 1; i < micro.length; i++) { const s = Math.round(micro[i].t - micro[i - 1].t); spac[s] = (spac[s] || 0) + 1; }
      console.log('  inter-gap spacing histogram (sec:count):', Object.entries(spac).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, c]) => `${s}:${c}`).join('  '));
      console.log(micro.length > 20 ? '  ❌ VERDICT: drops STILL PRESENT (upgrade did not fix / rolled back?)' : '  ✅ VERDICT: few/no periodic drops — looks FIXED (compare to pre-upgrade count).');
    } else {
      console.log('  ✅ VERDICT: essentially no micro-gaps — clean.');
    }
  } catch (e) {
    console.log('analysis error:', (e as Error).message);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('\n(Compare the micro-gap count + PERIODIC/clean verdict against the PRE-upgrade baseline for the same DJ.)');
  process.exit(0);
})();

function median(a: number[]): number { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1); }
