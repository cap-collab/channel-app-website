/**
 * Migration script to convert inline irlShows to the events collection
 *
 * This script:
 * 1. Reads all users with djProfile.irlShows entries
 * 2. Reads all pending-dj-profiles with djProfile.irlShows entries
 * 3. Creates event documents in the events collection for each show
 * 4. Clears the irlShows array from the source documents
 *
 * Run with: npx tsx scripts/migrate-irl-shows-to-events.ts
 * Dry run:  npx tsx scripts/migrate-irl-shows-to-events.ts --dry-run
 */

import * as admin from 'firebase-admin';
import { getApps } from 'firebase-admin/app';

if (!getApps().length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID || 'channel-97386',
  });
}

const db = admin.firestore();
const isDryRun = process.argv.includes('--dry-run');

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface IrlShow {
  name?: string;
  location?: string;
  url?: string;
  date?: string;
  imageUrl?: string;
  venueId?: string;
  venueName?: string;
  linkedCollectives?: { collectiveId: string; collectiveName: string }[];
  djs?: { djName: string; djUserId?: string; djUsername?: string; djPhotoUrl?: string }[];
}

async function getUniqueSlugs(): Promise<Set<string>> {
  const snapshot = await db.collection('events').get();
  const slugs = new Set<string>();
  snapshot.forEach(doc => {
    const slug = doc.data().slug;
    if (slug) slugs.add(slug);
  });
  return slugs;
}

async function migrateUserIrlShows(existingSlugs: Set<string>) {
  console.log('\n=== Migrating user djProfile.irlShows ===');
  const usersSnapshot = await db.collection('users').get();

  let totalShows = 0;
  let migratedShows = 0;

  for (const userDoc of usersSnapshot.docs) {
    const data = userDoc.data();
    const irlShows: IrlShow[] = data.djProfile?.irlShows || [];
    if (irlShows.length === 0) continue;

    // Filter out empty shows
    const validShows = irlShows.filter(
      s => (s.name || '').trim() || (s.date || '').trim() || (s.url || '').trim()
    );
    if (validShows.length === 0) continue;

    const chatUsername = data.chatUsername || '';
    const normalizedUsername = data.chatUsernameNormalized || chatUsername.replace(/\s+/g, '').toLowerCase();
    const photoUrl = data.djProfile?.photoUrl || null;

    console.log(`\nUser: ${chatUsername} (${userDoc.id}) — ${validShows.length} shows`);
    totalShows += validShows.length;

    for (const show of validShows) {
      const name = (show.name || 'Event').trim();
      const dateMs = show.date ? new Date(show.date + 'T00:00:00').getTime() : Date.now();

      // Generate unique slug
      let baseSlug = generateSlug(name);
      if (!baseSlug) baseSlug = 'event';
      let slug = baseSlug;
      let suffix = 2;
      while (existingSlugs.has(slug)) {
        slug = `${baseSlug}-${suffix}`;
        suffix++;
      }
      existingSlugs.add(slug);

      // Build DJs array — always include the owning DJ
      const djs = [
        { djName: chatUsername, djUserId: userDoc.id, djUsername: normalizedUsername, djPhotoUrl: photoUrl || undefined },
        ...(show.djs || []),
      ];

      const eventData = {
        name,
        slug,
        date: dateMs,
        endDate: null,
        photo: show.imageUrl || null,
        description: null,
        venueId: show.venueId || null,
        venueName: show.venueName || null,
        collectiveId: null,
        collectiveName: null,
        linkedVenues: show.venueId ? [{ venueId: show.venueId, venueName: show.venueName || '' }] : [],
        linkedCollectives: show.linkedCollectives || [],
        djs,
        genres: data.djProfile?.genres || [],
        location: show.location || null,
        ticketLink: show.url || null,
        socialLinks: {},
        source: 'dj',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: userDoc.id,
      };

      console.log(`  → "${name}" (${show.date || 'no date'}) → slug: ${slug}`);

      if (!isDryRun) {
        await db.collection('events').add(eventData);
        migratedShows++;
      }
    }

    // Clear irlShows from the user profile
    if (!isDryRun) {
      await db.collection('users').doc(userDoc.id).update({
        'djProfile.irlShows': [],
      });
      console.log(`  ✓ Cleared irlShows from user profile`);
    }
  }

  console.log(`\nUsers: ${totalShows} shows found, ${isDryRun ? 'would migrate' : 'migrated'} ${isDryRun ? totalShows : migratedShows}`);
}

async function migratePendingDjIrlShows(existingSlugs: Set<string>) {
  console.log('\n=== Migrating pending-dj-profiles irlShows ===');
  const pendingSnapshot = await db.collection('pending-dj-profiles').get();

  let totalShows = 0;
  let migratedShows = 0;

  for (const profileDoc of pendingSnapshot.docs) {
    const data = profileDoc.data();
    const irlShows: IrlShow[] = data.djProfile?.irlShows || [];
    if (irlShows.length === 0) continue;

    const validShows = irlShows.filter(
      s => (s.name || '').trim() || (s.date || '').trim() || (s.url || '').trim()
    );
    if (validShows.length === 0) continue;

    const chatUsername = data.chatUsername || '';
    const normalizedUsername = data.chatUsernameNormalized || chatUsername.replace(/\s+/g, '').toLowerCase();
    const photoUrl = data.djProfile?.photoUrl || null;

    console.log(`\nPending DJ: ${chatUsername} (${profileDoc.id}) — ${validShows.length} shows`);
    totalShows += validShows.length;

    for (const show of validShows) {
      const name = (show.name || 'Event').trim();
      const dateMs = show.date ? new Date(show.date + 'T00:00:00').getTime() : Date.now();

      let baseSlug = generateSlug(name);
      if (!baseSlug) baseSlug = 'event';
      let slug = baseSlug;
      let suffix = 2;
      while (existingSlugs.has(slug)) {
        slug = `${baseSlug}-${suffix}`;
        suffix++;
      }
      existingSlugs.add(slug);

      const djs = [
        { djName: chatUsername, djUsername: normalizedUsername, djPhotoUrl: photoUrl || undefined },
        ...(show.djs || []),
      ];

      const eventData = {
        name,
        slug,
        date: dateMs,
        endDate: null,
        photo: show.imageUrl || null,
        description: null,
        venueId: show.venueId || null,
        venueName: show.venueName || null,
        collectiveId: null,
        collectiveName: null,
        linkedVenues: show.venueId ? [{ venueId: show.venueId, venueName: show.venueName || '' }] : [],
        linkedCollectives: show.linkedCollectives || [],
        djs,
        genres: [],
        location: show.location || null,
        ticketLink: show.url || null,
        socialLinks: {},
        source: 'pending-admin',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: 'migration',
      };

      console.log(`  → "${name}" (${show.date || 'no date'}) → slug: ${slug}`);

      if (!isDryRun) {
        await db.collection('events').add(eventData);
        migratedShows++;
      }
    }

    // Clear irlShows from the pending profile
    if (!isDryRun) {
      await db.collection('pending-dj-profiles').doc(profileDoc.id).update({
        'djProfile.irlShows': [],
      });
      console.log(`  ✓ Cleared irlShows from pending profile`);
    }
  }

  console.log(`\nPending DJs: ${totalShows} shows found, ${isDryRun ? 'would migrate' : 'migrated'} ${isDryRun ? totalShows : migratedShows}`);
}

async function main() {
  console.log(isDryRun ? '🔍 DRY RUN MODE — no changes will be made\n' : '🚀 LIVE MODE — migrating data\n');

  const existingSlugs = await getUniqueSlugs();
  console.log(`Found ${existingSlugs.size} existing event slugs`);

  await migrateUserIrlShows(existingSlugs);
  await migratePendingDjIrlShows(existingSlugs);

  console.log('\n✅ Migration complete!');
}

main().catch(console.error);
