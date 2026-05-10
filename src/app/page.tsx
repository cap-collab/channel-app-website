import { Suspense } from 'react';
import { makeOG } from '@/lib/og';
import { ChannelClient } from './radio/ChannelClient';
import { getHeroArchives } from '@/lib/hero-archives';

export const metadata = makeOG();
export const dynamic = 'force-dynamic';

export default async function Home() {
  const heroSeed = await getHeroArchives();
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <ChannelClient
        initialHeroArchives={heroSeed.archives}
        initialPreferredHero={heroSeed.preferredHero}
      />
    </Suspense>
  );
}
