'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BroadcastSlotSerialized } from '@/types/broadcast';
import { getVenueSlots } from '@/lib/broadcast-slots';

interface VenueSlotsResponse {
  currentSlot: BroadcastSlotSerialized | null;
  nextSlot: BroadcastSlotSerialized | null;
}

interface VenueClientProps {
  venueSlug: string;
}

function useVenueSlots() {
  const [data, setData] = useState<VenueSlotsResponse>({ currentSlot: null, nextSlot: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSlots = useCallback(async () => {
    try {
      const result = await getVenueSlots();
      setData(result);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch venue slots:', err);
      setError('Failed to fetch venue slots');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  return { ...data, loading, error };
}

// Helper to get display name for show/DJ
function getDisplayName(slot: BroadcastSlotSerialized): string {
  if (slot.showName) return slot.showName;
  if (slot.djSlots && slot.djSlots.length > 0) {
    const firstDj = slot.djSlots.find(dj => dj.djName);
    return firstDj?.djName || 'Venue Broadcast';
  }
  return slot.djName || 'Venue Broadcast';
}

export function VenueClient({ venueSlug }: VenueClientProps) {
  const router = useRouter();
  const { currentSlot, nextSlot, loading, error } = useVenueSlots();
  const [redirecting, setRedirecting] = useState(false);

  // Redirect to token URL when slot is found
  useEffect(() => {
    if (currentSlot?.broadcastToken && !redirecting) {
      setRedirecting(true);
      router.push(`/broadcast/live?token=${currentSlot.broadcastToken}`);
    }
  }, [currentSlot, router, redirecting]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-gray-400">Loading venue schedule...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-8">
        <div className="bg-gray-900 rounded-xl p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Error Loading Schedule</h1>
          <p className="text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  // Redirecting state
  if (redirecting || currentSlot?.broadcastToken) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-gray-400">Redirecting to broadcast setup...</p>
        </div>
      </div>
    );
  }

  // No current slot
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-8">
      <div className="bg-gray-900 rounded-xl p-8 max-w-md text-center">
        <div className="w-16 h-16 bg-blue-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white mb-2">No Active Venue Slot</h1>
        <p className="text-gray-400 mb-4">
          There&apos;s no venue broadcast scheduled right now for {venueSlug}.
        </p>
        {nextSlot && (
          <div className="bg-gray-800 rounded-lg p-4 mt-4">
            <p className="text-gray-400 text-sm">Next up</p>
            <p className="text-white font-medium">{getDisplayName(nextSlot)}</p>
            <p className="text-gray-500 text-sm">
              {new Date(nextSlot.startTime).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · {new Date(nextSlot.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
