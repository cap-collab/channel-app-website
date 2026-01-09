import { Metadata } from 'next';
import { Suspense } from 'react';
import { ChannelClient } from './ChannelClient';

export const metadata: Metadata = {
  title: 'Channel Broadcast - Live Radio',
  description: 'Listen to Channel Broadcast live. Real-time chat, schedule, and more.',
};

export default function ChannelPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <ChannelClient />
    </Suspense>
  );
}
