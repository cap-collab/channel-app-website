import { Metadata } from 'next';
import { Suspense } from 'react';
import { VenueClient } from './VenueClient';

export const metadata: Metadata = {
  title: 'Venue Broadcast - Channel',
  description: 'Broadcast from the venue CDJs on Channel',
};

export default function VenueBroadcastPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    }>
      <VenueClient />
    </Suspense>
  );
}
