import { Suspense } from 'react';
import { makeOG } from '@/lib/og';
import { ChannelClient } from '@/components/channel/ChannelClient';
import { getHeroArchives } from '@/lib/hero-archives';
import { getAdminDb } from '@/lib/firebase-admin';
import { getFeaturedPayload, DEFAULT_FEATURED_CITY } from '@/lib/recommendations/featured-payload';

export const metadata = makeOG({ path: '/' });
export const dynamic = 'force-dynamic';

// The "Find Your Scene" grid below the hero shows a compact 6-cell featured
// matrix (spiral/star × downtempo/uptempo/very_slow). The featured matrix is
// emitted in row-major tempo order (very_fast last), so slicing to 6 drops the
// Intense row naturally.
const SCENE_GRID_SIZE = 6;

export default async function Home() {
  // Run the featured-scene seed concurrently with the hero fetch — both hit the
  // Firestore admin SDK and the featured payload is 5-min cached, so this adds
  // no serial latency to the initial render.
  const [heroSeed, sceneSeed] = await Promise.all([
    getHeroArchives(),
    (async () => {
      const db = getAdminDb();
      if (!db) return [];
      try {
        const payload = await getFeaturedPayload(db, Date.now(), DEFAULT_FEATURED_CITY);
        return payload.archives.slice(0, SCENE_GRID_SIZE);
      } catch {
        return [];
      }
    })(),
  ]);
  const seoArchives = heroSeed.archives.slice(0, 10);
  return (
    <>
      <h1 className="sr-only">Channel — independent online radio for music communities</h1>
      <div className="sr-only">
        <p>
          Channel is an internet radio platform for DJs, producers, collectives, and labels.
          Listen live, browse recent shows, and discover artists from scenes around the world.
        </p>
        <nav aria-label="Primary">
          <ul>
            <li><a href="/archives">Archives</a></li>
            <li><a href="/explore">Explore</a></li>
            <li><a href="/streaming-guide">Streaming guide</a></li>
            <li><a href="/dj-portal">DJ portal</a></li>
            <li><a href="/about">About</a></li>
          </ul>
        </nav>
        {seoArchives.length > 0 && (
          <section aria-label="Recent shows">
            <h2>Recent shows on Channel</h2>
            <ul>
              {seoArchives.map((archive) => {
                const djNames = archive.djs?.map((dj) => dj.name).filter(Boolean).join(', ');
                return (
                  <li key={archive.id}>
                    <a href={`/archives/${archive.slug}`}>
                      {archive.showName}
                      {djNames ? ` — ${djNames}` : ''}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
      <Suspense fallback={<div className="min-h-screen bg-black" />}>
        <ChannelClient
          initialHeroArchives={heroSeed.archives}
          initialPreferredHero={heroSeed.preferredHero}
          initialRadioArchiveId={heroSeed.currentRadioArchiveId}
          initialSceneArchives={sceneSeed}
        />
      </Suspense>
    </>
  );
}
