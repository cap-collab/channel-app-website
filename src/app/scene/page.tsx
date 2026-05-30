import { Suspense } from 'react';
import { makeOG } from '@/lib/og';
import { SceneClient } from './SceneClient';

export const metadata = makeOG({
  title: 'Your scene',
  description: 'Manage your scene on Channel — the DJs and shows you follow.',
  path: '/scene',
});

export default function ScenePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <SceneClient />
    </Suspense>
  );
}
