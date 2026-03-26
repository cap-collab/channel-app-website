/**
 * One-off script to populate genres for NTS pending DJ profiles
 *
 * Fetches genres from NTS show pages (window._REACT_STATE_.show.episodes[0].genres)
 * and updates pending-dj-profiles in Firebase.
 *
 * Run with: npx tsx scripts/populate-nts-genres.ts
 * Dry run (test one): npx tsx scripts/populate-nts-genres.ts --test-one
 */

import * as admin from 'firebase-admin';
import { getApps, cert } from 'firebase-admin/app';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local for Firebase credentials
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// Initialize Firebase Admin using service account credentials
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

async function fetchNTSGenres(slug: string): Promise<string[]> {
  try {
    const url = `https://www.nts.live/shows/${slug}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.status !== 200) return [];

    const html = await res.text();

    // Extract window._REACT_STATE_ (same regex as sync-auto-dj-profiles)
    const stateMatch = html.match(/window\._REACT_STATE_\s*=\s*(\{.*\});\s*<\/script>/);
    if (!stateMatch) return [];

    const state = JSON.parse(stateMatch[1]);
    const episodes = state?.show?.episodes;
    if (!episodes || !Array.isArray(episodes) || episodes.length === 0) return [];

    // Get genres from the most recent episode
    const latestEpisode = episodes[0];
    const genres: Array<{ id: string; value: string }> = latestEpisode?.genres || [];

    return genres.map(g => g.value?.trim()).filter(Boolean);
  } catch (error) {
    console.warn(`  ⚠️  Failed to fetch genres for ${slug}:`, error instanceof Error ? error.message : error);
    return [];
  }
}

async function main() {
  console.log('Querying Firebase for NTS pending DJ profiles...\n');

  // Query all auto-generated pending profiles
  const snapshot = await db.collection('pending-dj-profiles')
    .where('source', '==', 'auto')
    .get();

  // Filter for NTS profiles
  const ntsProfiles = snapshot.docs.filter(doc => {
    const data = doc.data();
    const hasNtsSource = data.autoSources?.some(
      (s: { stationId: string }) => s.stationId === 'nts-1' || s.stationId === 'nts-2'
    );
    const hasNtsUrl = data.validatedFrom?.includes('nts.live');
    return hasNtsSource || hasNtsUrl;
  });

  console.log(`Total auto-generated pending profiles: ${snapshot.size}`);
  console.log(`NTS pending profiles: ${ntsProfiles.length}\n`);

  // Filter to those with empty genres
  const profilesToUpdate = ntsProfiles.filter(doc => {
    const genres = doc.data().djProfile?.genres;
    return !genres || genres.length === 0;
  });

  const alreadyHasGenres = ntsProfiles.length - profilesToUpdate.length;
  console.log(`Already have genres: ${alreadyHasGenres}`);
  console.log(`Need genres: ${profilesToUpdate.length}\n`);

  if (TEST_ONE) {
    const doc = profilesToUpdate[0];
    if (!doc) {
      console.log('No profiles to update!');
      return;
    }

    const data = doc.data();
    const slug = data.validatedFrom
      ?.replace('https://www.nts.live/shows/', '')
      ?.replace(/\/$/, '');

    console.log('=== TEST: Processing one NTS DJ ===');
    console.log(`  Doc ID:         ${doc.id}`);
    console.log(`  DJ Name:        ${data.djName || data.chatUsername}`);
    console.log(`  Slug:           ${slug}`);
    console.log(`  validatedFrom:  ${data.validatedFrom}`);
    console.log(`  Current genres: ${JSON.stringify(data.djProfile?.genres || [])}`);

    if (!slug) {
      console.log('  ❌ No slug found from validatedFrom URL');
      return;
    }

    console.log(`\n  Fetching genres from NTS show page...`);
    const genres = await fetchNTSGenres(slug);
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
  let noGenres = 0;
  let noSlug = 0;
  let errors = 0;
  const failedProfiles: Array<{ djName: string; docId: string; slug: string | undefined; validatedFrom: string | undefined; reason: string }> = [];

  for (const doc of profilesToUpdate) {
    const data = doc.data();
    const djName = data.djName || data.chatUsername;
    const slug = data.validatedFrom
      ?.replace('https://www.nts.live/shows/', '')
      ?.replace(/\/$/, '');

    if (!slug) {
      console.log(`⚠️  ${djName} - no slug in validatedFrom`);
      failedProfiles.push({ djName, docId: doc.id, slug, validatedFrom: data.validatedFrom, reason: 'no slug in validatedFrom' });
      noSlug++;
      continue;
    }

    try {
      const genres = await fetchNTSGenres(slug);

      if (genres.length > 0) {
        await doc.ref.update({ 'djProfile.genres': genres });
        console.log(`✅ ${djName} → ${genres.join(', ')}`);
        updated++;
      } else {
        console.log(`—  ${djName} (${slug}) → no genres found`);
        failedProfiles.push({ djName, docId: doc.id, slug, validatedFrom: data.validatedFrom, reason: 'no episodes or no genre tags on latest episode' });
        noGenres++;
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 150));
    } catch (err) {
      console.log(`❌ ${djName} → error: ${err}`);
      failedProfiles.push({ djName, docId: doc.id, slug, validatedFrom: data.validatedFrom, reason: `error: ${err}` });
      errors++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Total NTS profiles:    ${ntsProfiles.length}`);
  console.log(`Already had genres:    ${alreadyHasGenres}`);
  console.log(`Updated with genres:   ${updated}`);
  console.log(`No genres found:       ${noGenres}`);
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
