/**
 * One-shot: regenerate the archive-radio schedule for a given UTC date.
 * Bypasses the locked check (admin-driven). Pass --date=YYYY-MM-DD or
 * defaults to today UTC.
 *
 *   npx tsx scripts/regen-archive-schedule.ts
 *   npx tsx scripts/regen-archive-schedule.ts --date=2026-05-10
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { generateScheduleForDate } from '../src/lib/archive-schedule-server';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of process.argv) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return undefined;
}

function todayUtc(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function main() {
  const date = arg('date') ?? todayUtc();
  console.log(`Regenerating archive-schedule/${date} (force=true)`);
  const result = await generateScheduleForDate({
    dateId: date,
    force: true,
    generatedBy: 'admin',
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
