import { Metadata } from 'next';
import { Suspense } from 'react';
import { BroadcastClient } from './BroadcastClient';

export const metadata: Metadata = {
  title: 'Go Live - Channel',
  description: 'Broadcast your DJ set live on Channel',
};

export default function BroadcastPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    }>
      <BroadcastClient />
    </Suspense>
  );
}
