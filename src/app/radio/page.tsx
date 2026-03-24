import { Suspense } from 'react';
import { makeOG } from '@/lib/og';
import { ChannelClient } from './ChannelClient';

export const metadata = makeOG();

export default function ChannelPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <ChannelClient />
    </Suspense>
  );
}
