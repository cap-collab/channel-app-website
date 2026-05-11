import { Suspense } from 'react';
import { makeOG } from '@/lib/og';
import { ExploreClient } from './ExploreClient';

export const metadata = makeOG({
  title: "Explore",
  description: "Explore scenes, DJs, venues, and collectives across Channel.",
  path: "/explore",
});

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <ExploreClient />
    </Suspense>
  );
}
