/**
 * One-shot migration: update all recordingUrl fields from the old R2 dev URL
 * to the new CDN domain (media.channel-app.com).
 *
 * Stores old URLs in _urlMigrationBackup field for rollback safety.
 *
 * Run with: npx tsx -r tsconfig-paths/register scripts/migrate-r2-urls.ts [--dry-run]
 */

// Load env before anything else
import { config } from 'next/dist/lib/config';

// Use Next.js env loading
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { getAdminDb } from '../src/lib/firebase-admin';

const OLD_PREFIX = 'https://pub-de855cd714814c9eaedcfcc2db1880ed.r2.dev';
const NEW_PREFIX = 'https://media.channel-app.com';

const dryRun = process.argv.includes('--dry-run');

async function migrateCollection(db: FirebaseFirestore.Firestore, collectionName: string, fields: string[]) {
  const snapshot = await db.collection(collectionName).get();
  let updated = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates: Record<string, unknown> = {};
    const backup: Record<string, unknown> = {};

    for (const field of fields) {
      const value = data[field];
      if (typeof value === 'string' && value.startsWith(OLD_PREFIX)) {
        backup[field] = value;
        updates[field] = value.replace(OLD_PREFIX, NEW_PREFIX);
      }
    }

    // Also check nested recordings array (broadcast-slots)
    if (data.recordings && Array.isArray(data.recordings)) {
      let recordingsChanged = false;
      const newRecordings = data.recordings.map((rec: Record<string, unknown>) => {
        if (typeof rec.url === 'string' && rec.url.startsWith(OLD_PREFIX)) {
          recordingsChanged = true;
          return { ...rec, url: rec.url.replace(OLD_PREFIX, NEW_PREFIX) };
        }
        return rec;
      });
      if (recordingsChanged) {
        backup['recordings'] = data.recordings;
        updates['recordings'] = newRecordings;
      }
    }

    if (Object.keys(updates).length > 0) {
      if (dryRun) {
        for (const [field, val] of Object.entries(updates)) {
          if (typeof val === 'string') {
            console.log(`[DRY RUN] ${collectionName}/${doc.id}.${field}:`);
            console.log(`  old: ${backup[field]}`);
            console.log(`  new: ${val}`);
          } else {
            console.log(`[DRY RUN] ${collectionName}/${doc.id}.${field}: (nested array updated)`);
          }
        }
      } else {
        await doc.ref.update({
          ...updates,
          _urlMigrationBackup: backup,
          _urlMigratedAt: new Date().toISOString(),
        });
        console.log(`Updated ${collectionName}/${doc.id}:`, Object.keys(updates).join(', '));
      }
      updated++;
    }
  }

  console.log(`\n${collectionName}: ${updated} docs ${dryRun ? 'would be' : ''} updated out of ${snapshot.size}`);
  return updated;
}

async function main() {
  const db = getAdminDb();
  if (!db) {
    console.error('Firebase Admin not configured');
    process.exit(1);
  }

  console.log(dryRun ? '=== DRY RUN (no changes will be made) ===' : '=== MIGRATING (backup stored in _urlMigrationBackup) ===');
  console.log(`Old: ${OLD_PREFIX}`);
  console.log(`New: ${NEW_PREFIX}\n`);

  const archiveCount = await migrateCollection(db, 'archives', ['recordingUrl']);
  const slotCount = await migrateCollection(db, 'broadcast-slots', ['recordingUrl', 'archiveRecordingUrl']);

  console.log(`\nDone. Archives: ${archiveCount}, Slots: ${slotCount}`);
}

main().catch(console.error);
