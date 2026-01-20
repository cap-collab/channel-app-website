/**
 * Script to create Junior's pending DJ profile
 *
 * Run with: npx ts-node --skip-project scripts/create-junior-profile.ts
 *
 * Or you can use the admin API endpoint directly:
 * POST /api/admin/create-pending-dj-profile
 * with Authorization: Bearer <your-firebase-id-token>
 * and body:
 * {
 *   "email": "juniorsbl@gmail.com",
 *   "username": "Junior",
 *   "djProfile": {
 *     "bio": "Your bio here",
 *     "location": "Your location",
 *     "genres": ["House", "Techno"]
 *   }
 * }
 */

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Initialize Firebase Admin
// Make sure GOOGLE_APPLICATION_CREDENTIALS is set or use service account
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();

async function createJuniorProfile() {
  const email = 'juniorsbl@gmail.com';
  const username = 'Junior';
  const normalizedUsername = 'junior';

  // Check if user already exists
  const existingUserSnapshot = await db.collection('users')
    .where('email', '==', email.toLowerCase())
    .limit(1)
    .get();

  if (!existingUserSnapshot.empty) {
    console.log('User with this email already exists!');
    return;
  }

  // Check if username is taken
  const usernameDoc = await db.collection('usernames').doc(normalizedUsername).get();
  if (usernameDoc.exists && !usernameDoc.data()?.isPending) {
    console.log('Username is already taken!');
    return;
  }

  // Check if pending profile exists
  const existingPendingSnapshot = await db.collection('pending-dj-profiles')
    .where('email', '==', email.toLowerCase())
    .where('status', '==', 'pending')
    .limit(1)
    .get();

  if (!existingPendingSnapshot.empty) {
    console.log('Pending profile already exists for this email!');
    return;
  }

  // Create the pending DJ profile
  const pendingProfileRef = db.collection('pending-dj-profiles').doc();
  const usernameRef = db.collection('usernames').doc(normalizedUsername);
  const pendingDJRoleRef = db.collection('pending-dj-roles').doc();

  await db.runTransaction(async (transaction) => {
    // Create pending DJ profile
    transaction.set(pendingProfileRef, {
      email: email.toLowerCase(),
      chatUsername: username,
      chatUsernameNormalized: normalizedUsername,
      djProfile: {
        bio: null, // You can fill this in
        photoUrl: null, // You can fill this in
        location: null,
        genres: [],
        promoText: null,
        promoHyperlink: null,
        socialLinks: {},
      },
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'script',
    });

    // Reserve the username
    transaction.set(usernameRef, {
      displayName: username,
      usernameHandle: normalizedUsername,
      uid: `pending:${email.toLowerCase()}`,
      reservedForEmail: email.toLowerCase(),
      isPending: true,
      claimedAt: FieldValue.serverTimestamp(),
    });

    // Create pending DJ role entry
    transaction.set(pendingDJRoleRef, {
      email: email.toLowerCase(),
      createdAt: FieldValue.serverTimestamp(),
      source: 'admin-pre-register',
    });
  });

  console.log(`Created pending DJ profile for ${email} with username ${username}`);
  console.log(`Profile URL: /dj/${normalizedUsername}`);
}

createJuniorProfile()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
