import { Suspense } from 'react';
import { makeOG } from '@/lib/og';
import { StreamingGuideClient } from './StreamingGuideClient';

export const metadata = makeOG({
  title: "Streaming Guide",
  description: "Set up your gear, software, and stream key to broadcast on Channel.",
});

export default function StreamingGuidePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <StreamingGuideClient />
    </Suspense>
  );
}
