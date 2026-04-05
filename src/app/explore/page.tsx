import { Suspense } from 'react';
import { makeOG } from '@/lib/og';
import { ExploreClient } from './ExploreClient';

export const metadata = makeOG({ title: 'Explore the Scene' });

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <ExploreClient />
    </Suspense>
  );
}
