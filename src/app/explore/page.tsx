import { Suspense } from 'react';
import { makeOG } from '@/lib/og';
import { ChannelClient } from '../radio/ChannelClient';

export const metadata = makeOG({ title: 'Explore the Scene' });

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <ChannelClient skipHero />
    </Suspense>
  );
}
