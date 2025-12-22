import { Metadata } from 'next';
import { Suspense } from 'react';
import { VenueClient } from './VenueClient';

interface VenuePageProps {
  params: Promise<{ venue: string }>;
}

export async function generateMetadata({ params }: VenuePageProps): Promise<Metadata> {
  const { venue } = await params;
  // Capitalize first letter for display
  const venueName = venue.charAt(0).toUpperCase() + venue.slice(1);
  return {
    title: `${venueName} Broadcast - Channel`,
    description: `Broadcast from ${venueName} on Channel`,
  };
}

export default async function VenueBroadcastPage({ params }: VenuePageProps) {
  const { venue } = await params;

  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    }>
      <VenueClient venueSlug={venue} />
    </Suspense>
  );
}
