/**
 * Migration script to reserve usernames for all pending DJ profiles
 *
 * This script:
 * 1. Fetches all pending DJ profiles with status='pending'
 * 2. Checks if their username is already reserved in the 'usernames' collection
 * 3. If not, creates a reservation with isPending=true
 *
 * Run with: npx ts-node scripts/reserve-pending-dj-usernames.ts
 * Or: npx tsx scripts/reserve-pending-dj-usernames.ts
 */

import * as admin from 'firebase-admin';
import { getApps } from 'firebase-admin/app';

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID || 'channel-97386',
  });
}

const db = admin.firestore();

interface PendingProfile {
  id: string;
  chatUsername: string;
  chatUsernameNormalized: string;
  email?: string;
  status: string;
}

async function reservePendingDJUsernames() {
  console.log('Starting username reservation migration...\n');

  // Fetch all pending DJ profiles
  const pendingSnapshot = await db.collection('pending-dj-profiles')
    .where('status', '==', 'pending')
    .get();

  console.log(`Found ${pendingSnapshot.size} pending DJ profiles\n`);

  let reserved = 0;
  let alreadyExists = 0;
  let conflicts = 0;
  let errors = 0;

  for (const doc of pendingSnapshot.docs) {
    const data = doc.data();
    const profile: PendingProfile = {
      id: doc.id,
      chatUsername: data.chatUsername,
      chatUsernameNormalized: data.chatUsernameNormalized,
      email: data.email,
      status: data.status,
    };

    if (!profile.chatUsernameNormalized) {
      console.log(`⚠️  Skipping ${profile.chatUsername} - no normalized username`);
      errors++;
      continue;
    }

    const usernameRef = db.collection('usernames').doc(profile.chatUsernameNormalized);
    const usernameDoc = await usernameRef.get();

    if (usernameDoc.exists) {
      const existingData = usernameDoc.data();

      // Check if it's already reserved for this pending profile
      if (existingData?.isPending) {
        console.log(`✓  ${profile.chatUsername} - already reserved (pending)`);
        alreadyExists++;
      } else {
        // Username taken by a real user - conflict!
        console.log(`❌ ${profile.chatUsername} - CONFLICT: username taken by uid ${existingData?.uid}`);
        conflicts++;
      }
    } else {
      // Reserve the username
      try {
        await usernameRef.set({
          displayName: profile.chatUsername,
          usernameHandle: profile.chatUsernameNormalized,
          uid: profile.email ? `pending:${profile.email}` : `pending:${doc.id}`,
          reservedForEmail: profile.email || null,
          isPending: true,
          claimedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`✅ ${profile.chatUsername} - RESERVED`);
        reserved++;
      } catch (err) {
        console.log(`❌ ${profile.chatUsername} - ERROR: ${err}`);
        errors++;
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Reserved:       ${reserved}`);
  console.log(`Already exists: ${alreadyExists}`);
  console.log(`Conflicts:      ${conflicts}`);
  console.log(`Errors:         ${errors}`);
  console.log(`Total:          ${pendingSnapshot.size}`);

  if (conflicts > 0) {
    console.log('\n⚠️  Some usernames have conflicts - they are already taken by real users.');
    console.log('   You may need to rename those pending DJ profiles.');
  }
}

reservePendingDJUsernames()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
