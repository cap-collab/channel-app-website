/**
 * One-shot: regenerate (or generate) an archive-radio loop. Bypasses the
 * locked check (admin-driven). Pass --loop=N to target a specific loop.
 * If --loop is omitted and no loops exist, generates loop #1. If loops
 * exist, generates `max(loopNumber) + 1` (i.e. ensures the next loop).
 *
 *   npx tsx scripts/regen-archive-radio-loop.ts                # ensure next
 *   npx tsx scripts/regen-archive-radio-loop.ts --loop=1       # force-regen 1
 *   npx tsx scripts/regen-archive-radio-loop.ts --loop=3       # force-regen 3
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import {
  ensureNextLoop,
  generateLoop,
  maxLoopNumber,
} from '../src/lib/archive-schedule-server';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of process.argv) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return undefined;
}

async function main() {
  const loopArg = arg('loop');
  if (loopArg) {
    const loopNumber = Number(loopArg);
    if (!Number.isInteger(loopNumber) || loopNumber < 1) {
      throw new Error(`invalid --loop=${loopArg}; expected positive integer`);
    }
    console.log(`Regenerating archive-radio-loop/loop-${String(loopNumber).padStart(4, '0')} (force=true)`);
    const result = await generateLoop({
      loopNumber,
      force: true,
      generatedBy: 'admin',
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const max = await maxLoopNumber();
  if (max === 0) {
    console.log('No loops yet — generating loop #1');
    const result = await generateLoop({ loopNumber: 1, generatedBy: 'admin' });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Latest loop is #${max} — ensuring next loop exists`);
  const result = await ensureNextLoop({ generatedBy: 'admin' });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
