import { Suspense } from 'react';
import { DemoClient } from './DemoClient';
import { getHeroArchives } from '@/lib/hero-archives';

export const metadata = {
  robots: 'noindex, nofollow',
};

export const dynamic = 'force-dynamic';

export default async function RadioDemoPage() {
  // Same SSR hero seed as /radio so the second carousel slide can paint
  // immediately instead of waiting for the client fetch.
  const heroSeed = await getHeroArchives();
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <DemoClient
        initialHeroArchives={heroSeed.archives}
        initialPreferredHero={heroSeed.preferredHero}
      />
    </Suspense>
  );
}
