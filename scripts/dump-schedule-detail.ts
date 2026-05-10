import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { getAdminDb } from '../src/lib/firebase-admin';
async function main() {
  const date = process.argv.find(a => a.startsWith('--date='))?.slice(7) ?? '2026-05-10';
  const db = getAdminDb(); if (!db) throw new Error('no db');
  const snap = await db.collection('archive-schedule').doc(date).get();
  const items = (snap.data()?.items ?? []) as Array<Record<string, number>>;
  let prevEnd = 0;
  items.forEach((it, i) => {
    const start = it.startOffsetSec;
    const dur = it.durationSec;
    const end = start + dur;
    const startH = Math.floor(start / 3600);
    const startM = Math.floor((start % 3600) / 60);
    const startS = start % 60;
    const gap = i === 0 ? 0 : start - prevEnd;
    console.log(`#${String(i).padStart(2)} start=${start}s (${startH}h ${startM}m ${startS}s)  dur=${Math.floor(dur/60)}m ${dur%60}s  gap-from-prev=${gap}s  ${(it as any).title ?? ''}`);
    prevEnd = end;
  });
}
main().then(() => process.exit(0));
