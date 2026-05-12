import { Suspense } from 'react';
import { makeOG } from '@/lib/og';
import { ChannelClient } from '@/components/channel/ChannelClient';
import { getHeroArchives } from '@/lib/hero-archives';

export const metadata = makeOG({ path: '/' });
export const dynamic = 'force-dynamic';

export default async function Home() {
  const heroSeed = await getHeroArchives();
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
        />
      </Suspense>
    </>
  );
}
