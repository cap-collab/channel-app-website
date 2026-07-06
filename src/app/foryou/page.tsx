import { Suspense } from 'react';
import { makeOG } from '@/lib/og';
import { SceneClient } from './SceneClient';

export const metadata = makeOG({
  title: 'For You',
  description: 'Your For You page on Channel — the DJs and shows you follow.',
  path: '/foryou',
});

export default function ScenePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <SceneClient />
    </Suspense>
  );
}
