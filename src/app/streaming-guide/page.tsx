import { Metadata } from 'next';
import { Suspense } from 'react';
import { StreamingGuideClient } from './StreamingGuideClient';

export const metadata: Metadata = {
  title: 'Streaming Setup Guide - Channel',
  description: 'Learn how to set up your livestream on Channel. Check if your equipment is ready and get step-by-step setup instructions.',
};

export default function StreamingGuidePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <StreamingGuideClient />
    </Suspense>
  );
}
