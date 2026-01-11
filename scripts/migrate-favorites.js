#!/usr/bin/env node

/**
 * Migration script to fix invalid favorites across all users.
 * Finds favorites with type="show" but no stationId and updates them to type="search".
 *
 * Usage:
 *   DRY_RUN=true node scripts/migrate-favorites.js   # Preview changes
 *   node scripts/migrate-favorites.js                 # Execute migration
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account JSON
 * Or: Run from a machine with Application Default Credentials configured
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
// Try to use service account from env, otherwise use application default credentials
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  } else {
    // Try to initialize with the project ID from env
    admin.initializeApp({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'channel-app-8f498',
    });
  }
} catch (error) {
  console.error('Failed to initialize Firebase Admin:', error.message);
  console.log('\nTo run this script, you need one of:');
  console.log('1. GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account JSON');
  console.log('2. Application Default Credentials configured (gcloud auth application-default login)');
  process.exit(1);
}

const db = admin.firestore();
const isDryRun = process.env.DRY_RUN === 'true';

async function migrate() {
  console.log(isDryRun ? '\n=== DRY RUN MODE ===' : '\n=== EXECUTING MIGRATION ===');
  console.log('Finding favorites with type="show" but no stationId...\n');

  const usersSnapshot = await db.collection('users').get();
  console.log(`Found ${usersSnapshot.size} users to scan\n`);

  let totalInvalid = 0;
  let totalFixed = 0;
  const changes = [];

  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id;
    const favoritesSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('favorites')
      .get();

    for (const favDoc of favoritesSnapshot.docs) {
      const data = favDoc.data();
      const { type, stationId, term } = data;

      // Find favorites with type="show" but no stationId
      if (type === 'show' && !stationId) {
        totalInvalid++;
        changes.push({
          userId,
          docId: favDoc.id,
          term: term || 'unknown',
          currentType: type,
          newType: 'search',
        });

        if (!isDryRun) {
          // Update to type="search" (proper watchlist type)
          await db
            .collection('users')
            .doc(userId)
            .collection('favorites')
            .doc(favDoc.id)
            .update({ type: 'search' });
          totalFixed++;
          console.log(`✓ Fixed: user=${userId}, term="${term}" -> type="search"`);
        } else {
          console.log(`  Would fix: user=${userId}, term="${term}" -> type="search"`);
        }
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Users scanned: ${usersSnapshot.size}`);
  console.log(`Invalid favorites found: ${totalInvalid}`);

  if (isDryRun) {
    console.log('\nThis was a DRY RUN. No changes were made.');
    console.log('Run without DRY_RUN=true to execute the migration.');
  } else {
    console.log(`Favorites fixed: ${totalFixed}`);
  }

  if (changes.length > 0) {
    console.log('\nChanges:');
    console.table(changes);
  }

  return { totalInvalid, totalFixed, changes };
}

// Run the migration
migrate()
  .then((result) => {
    console.log('\nMigration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nMigration failed:', error);
    process.exit(1);
  });
