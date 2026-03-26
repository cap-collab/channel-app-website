/**
 * One-off script to populate genres for dublab pending DJ profiles
 *
 * Fetches genres from dublab's archive API (latest episode tags)
 * and updates pending-dj-profiles in Firebase.
 *
 * Run with: npx tsx scripts/populate-dublab-genres.ts
 * Dry run (test one): npx tsx scripts/populate-dublab-genres.ts --test-one
 */

import * as admin from 'firebase-admin';
import { getApps, cert } from 'firebase-admin/app';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local for Firebase credentials
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// Initialize Firebase Admin using service account credentials (same as firebase-admin.ts)
if (!getApps().length) {
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'channel-97386';
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;

  const hasValidKey = privateKey && privateKey.includes('BEGIN PRIVATE KEY');
  if (hasValidKey && clientEmail) {
    admin.initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.includes('\\n')
          ? privateKey.replace(/\\n/g, '\n')
          : privateKey,
      }),
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
    });
  }
}

const db = admin.firestore();

const TEST_ONE = process.argv.includes('--test-one');

async function fetchDublabGenres(slug: string): Promise<string[]> {
  try {
    // Step 1: Get archive listing for this DJ
    const archiveRes = await fetch(
      `https://dublab.wpengine.com/wp-json/lazystate/v1/archive?artist=${slug}`,
      {
        headers: { Origin: 'https://www.dublab.com' },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (archiveRes.status !== 200) return [];

    const archiveData = await archiveRes.json();
    const archiveKey = Object.keys(archiveData).find(k => k.startsWith('/archive'));
    const archiveObj = archiveKey ? archiveData[archiveKey] : null;
    const pages: string[] = archiveObj?.pages || [];
    if (pages.length === 0) return [];

    // Step 2: Get the latest episode's tags
    const latestPath = pages[0];
    const episodeSlug = latestPath.replace('/archive/', '');

    const episodeRes = await fetch(
      `https://dublab.wpengine.com/wp-json/lazystate/v1/archive/${episodeSlug}`,
      {
        headers: { Origin: 'https://www.dublab.com' },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (episodeRes.status !== 200) return [];

    const episodeData = await episodeRes.json();
    const episodeKey = Object.keys(episodeData).find(k => k.startsWith('/archive/'));
    const episode = episodeKey ? episodeData[episodeKey] : null;
    const tags: Array<{ name: string; slug: string }> = episode?.tags || [];

    return tags.map(t => t.name);
  } catch (error) {
    console.warn(`  ⚠️  Failed to fetch genres for ${slug}:`, error);
    return [];
  }
}

async function main() {
  console.log('Querying Firebase for dublab pending DJ profiles...\n');

  // Query all auto-generated pending profiles
  const snapshot = await db.collection('pending-dj-profiles')
    .where('source', '==', 'auto')
    .get();

  // Filter for dublab profiles
  const dublabProfiles = snapshot.docs.filter(doc => {
    const data = doc.data();
    // Check autoSources for dublab
    const hasDublabSource = data.autoSources?.some(
      (s: { stationId: string }) => s.stationId === 'dublab'
    );
    // Or check validatedFrom URL
    const hasDublabUrl = data.validatedFrom?.includes('dublab.com');
    return hasDublabSource || hasDublabUrl;
  });

  console.log(`Total auto-generated pending profiles: ${snapshot.size}`);
  console.log(`Dublab pending profiles: ${dublabProfiles.length}\n`);

  // Filter to those with empty genres
  const profilesToUpdate = dublabProfiles.filter(doc => {
    const genres = doc.data().djProfile?.genres;
    return !genres || genres.length === 0;
  });

  const alreadyHasGenres = dublabProfiles.length - profilesToUpdate.length;
  console.log(`Already have genres: ${alreadyHasGenres}`);
  console.log(`Need genres: ${profilesToUpdate.length}\n`);

  if (TEST_ONE) {
    // Just process the first one to demonstrate the flow
    const doc = profilesToUpdate[0];
    if (!doc) {
      console.log('No profiles to update!');
      return;
    }

    const data = doc.data();
    const slug = data.validatedFrom
      ?.replace('https://www.dublab.com/djs/', '')
      ?.replace(/\/$/, '');

    console.log('=== TEST: Processing one DJ ===');
    console.log(`  Doc ID:         ${doc.id}`);
    console.log(`  DJ Name:        ${data.djName || data.chatUsername}`);
    console.log(`  Slug:           ${slug}`);
    console.log(`  validatedFrom:  ${data.validatedFrom}`);
    console.log(`  Current genres: ${JSON.stringify(data.djProfile?.genres || [])}`);

    if (!slug) {
      console.log('  ❌ No slug found from validatedFrom URL');
      return;
    }

    console.log(`\n  Fetching genres from archive API...`);
    const genres = await fetchDublabGenres(slug);
    console.log(`  Genres found:   ${JSON.stringify(genres)}`);

    if (genres.length > 0) {
      console.log(`\n  ✅ Would update djProfile.genres to: ${JSON.stringify(genres)}`);
      console.log(`  (Not writing to Firebase in --test-one mode)`);
    } else {
      console.log(`\n  ⚠️  No genres found for this DJ`);
    }

    return;
  }

  // Full run: process all profiles
  let updated = 0;
  let noArchive = 0;
  let noSlug = 0;
  let errors = 0;
  const failedProfiles: Array<{ djName: string; docId: string; slug: string | undefined; validatedFrom: string | undefined; reason: string }> = [];

  for (const doc of profilesToUpdate) {
    const data = doc.data();
    const djName = data.djName || data.chatUsername;
    const slug = data.validatedFrom
      ?.replace('https://www.dublab.com/djs/', '')
      ?.replace(/\/$/, '');

    if (!slug) {
      console.log(`⚠️  ${djName} - no slug in validatedFrom`);
      failedProfiles.push({ djName, docId: doc.id, slug, validatedFrom: data.validatedFrom, reason: 'no slug in validatedFrom' });
      noSlug++;
      continue;
    }

    try {
      const genres = await fetchDublabGenres(slug);

      if (genres.length > 0) {
        await doc.ref.update({ 'djProfile.genres': genres });
        console.log(`✅ ${djName} → ${genres.join(', ')}`);
        updated++;
      } else {
        console.log(`—  ${djName} (${slug}) → no archive/genres`);
        failedProfiles.push({ djName, docId: doc.id, slug, validatedFrom: data.validatedFrom, reason: 'no archive episodes or no tags on latest episode' });
        noArchive++;
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      console.log(`❌ ${djName} → error: ${err}`);
      failedProfiles.push({ djName, docId: doc.id, slug, validatedFrom: data.validatedFrom, reason: `error: ${err}` });
      errors++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Total dublab profiles: ${dublabProfiles.length}`);
  console.log(`Already had genres:    ${alreadyHasGenres}`);
  console.log(`Updated with genres:   ${updated}`);
  console.log(`No archive/genres:     ${noArchive}`);
  console.log(`No slug:               ${noSlug}`);
  console.log(`Errors:                ${errors}`);

  if (failedProfiles.length > 0) {
    console.log(`\n--- Profiles to investigate (${failedProfiles.length}) ---`);
    for (const p of failedProfiles) {
      console.log(`  ${p.djName} | docId: ${p.docId} | slug: ${p.slug || 'N/A'} | url: ${p.validatedFrom || 'N/A'} | reason: ${p.reason}`);
    }
  }
}

main()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
