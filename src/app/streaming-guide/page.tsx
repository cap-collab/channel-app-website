import { Suspense } from 'react';
import { makeOG } from '@/lib/og';
import { StreamingGuideClient } from './StreamingGuideClient';

export const metadata = makeOG();

export default function StreamingGuidePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <StreamingGuideClient />
    </Suspense>
  );
}
