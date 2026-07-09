/**
 * One-off backfill: mark every archive that ALREADY has track IDs as
 * trackIdsReadyEmailStatus:'sent', so the daily archive-track-ids-emails cron
 * never re-notifies the shows the one-time launch blast already covered.
 *
 * Run this BEFORE enabling the cron schedule. Idempotent: only touches archives
 * with non-empty trackIds that aren't already flagged.
 *
 * Usage:
 *   npx tsx scripts/backfill-track-ids-email-status.ts          # dry-run (counts only)
 *   npx tsx scripts/backfill-track-ids-email-status.ts --write  # stamp 'sent'
 */
import './lib/load-env';
import { getAdminDb } from '../src/lib/firebase-admin';
import { normalizeTrackIds } from '../src/lib/track-ids';

async function main() {
  const write = process.argv.includes('--write');
  const db = getAdminDb();
  if (!db) throw new Error('Firestore admin not configured (check .env.prod)');

  const snap = await db.collection('archives').get();
  let hasTracks = 0;
  let alreadyFlagged = 0;
  let toStamp = 0;
  let stamped = 0;

  for (const doc of snap.docs) {
    const a = doc.data();
    if (normalizeTrackIds(a.trackIds).length === 0) continue;
    hasTracks++;
    if (a.trackIdsReadyEmailStatus !== undefined) { alreadyFlagged++; continue; }
    toStamp++;
    if (write) {
      await doc.ref.update({ trackIdsReadyEmailStatus: 'sent', trackIdsReadyEmailSentAt: Date.now() });
      stamped++;
    }
  }

  console.log(`Archives scanned: ${snap.size}`);
  console.log(`  with track IDs: ${hasTracks}`);
  console.log(`  already flagged: ${alreadyFlagged}`);
  console.log(`  would stamp 'sent': ${toStamp}`);
  if (write) console.log(`  stamped: ${stamped}`);
  else console.log(`\nDRY RUN — nothing written. Re-run with --write to stamp.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
