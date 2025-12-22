'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { BroadcastSlotSerialized, RoomStatus } from '@/types/broadcast';
import { WeeklyCalendar } from '@/components/broadcast/admin/WeeklyCalendar';
import { SlotModal } from '@/components/broadcast/admin/SlotModal';

// Hardcoded owner UID - in production, check against a list or Firestore
const OWNER_UID = process.env.NEXT_PUBLIC_BROADCAST_OWNER_UID || '';

// Get start of current week (Sunday)
function getWeekStart(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function AdminDashboard() {
  const { user, isAuthenticated, loading: authLoading, signInWithGoogle } = useAuthContext();

  const [slots, setSlots] = useState<BroadcastSlotSerialized[]>([]);
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Calendar state
  const [currentWeekStart, setCurrentWeekStart] = useState(getWeekStart());

  // Modal state
  const [selectedSlot, setSelectedSlot] = useState<BroadcastSlotSerialized | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newSlotTimes, setNewSlotTimes] = useState<{ start: Date; end: Date } | null>(null);

  // Check if user is owner
  const isOwner = user?.uid === OWNER_UID || OWNER_UID === '';

  // Fetch slots
  const fetchSlots = useCallback(async () => {
    try {
      const res = await fetch('/api/broadcast/slots');
      const data = await res.json();
      setSlots(data.slots || []);
    } catch {
      console.error('Failed to fetch slots');
    }
  }, []);

  // Fetch room status
  const fetchRoomStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/livekit/room-status');
      const data = await res.json();
      setRoomStatus(data);
    } catch {
      console.error('Failed to fetch room status');
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (isAuthenticated && isOwner) {
      Promise.all([fetchSlots(), fetchRoomStatus()]).finally(() => setIsLoading(false));

      // Poll room status every 10 seconds
      const interval = setInterval(fetchRoomStatus, 10000);
      return () => clearInterval(interval);
    } else {
      setIsLoading(false);
    }
  }, [isAuthenticated, isOwner, fetchSlots, fetchRoomStatus]);

  // Handle slot click (edit)
  const handleSlotClick = (slot: BroadcastSlotSerialized) => {
    setSelectedSlot(slot);
    setNewSlotTimes(null);
    setIsModalOpen(true);
  };

  // Handle create slot from calendar drag
  const handleCreateSlot = (startTime: Date, endTime: Date) => {
    setSelectedSlot(null);
    setNewSlotTimes({ start: startTime, end: endTime });
    setIsModalOpen(true);
  };

  // Save slot (create or update)
  const handleSaveSlot = async (data: { djName: string; showName?: string; startTime: number; endTime: number }) => {
    if (selectedSlot) {
      // Update existing slot - for now just delete and recreate
      // TODO: Add proper PATCH support
      await fetch('/api/broadcast/slots', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: selectedSlot.id }),
      });
    }

    // Create new slot
    await fetch('/api/broadcast/slots', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await user?.getIdToken()}`,
      },
      body: JSON.stringify(data),
    });

    await fetchSlots();
  };

  // Delete slot
  const handleDeleteSlot = async (slotId: string) => {
    await fetch('/api/broadcast/slots', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotId }),
    });
    await fetchSlots();
  };

  // Close modal
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedSlot(null);
    setNewSlotTimes(null);
  };

  // Auth loading
  if (authLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-8">
        <div className="bg-gray-900 rounded-xl p-8 max-w-md text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Broadcast Admin</h1>
          <p className="text-gray-400 mb-6">
            Sign in to manage your radio station broadcasts.
          </p>
          <button
            onClick={() => signInWithGoogle()}
            className="w-full bg-white hover:bg-gray-100 text-black font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  // Not owner
  if (!isOwner) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-8">
        <div className="bg-gray-900 rounded-xl p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H9m3-3V8m0 0V6m0 2h2m-2 0H9" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-gray-400">
            You don&apos;t have permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl md:text-3xl font-bold">Broadcast Schedule</h1>

          {/* Live status */}
          {roomStatus && (
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${
              roomStatus.isLive ? 'bg-red-900/50' : 'bg-gray-800'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                roomStatus.isLive ? 'bg-red-500 animate-pulse' : 'bg-gray-500'
              }`}></div>
              <span className={roomStatus.isLive ? 'text-red-400' : 'text-gray-400'}>
                {roomStatus.isLive ? `Live: ${roomStatus.currentDJ}` : 'Off Air'}
              </span>
            </div>
          )}
        </div>

        {/* Loading */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          </div>
        ) : (
          /* Calendar */
          <WeeklyCalendar
            slots={slots}
            onSlotClick={handleSlotClick}
            onCreateSlot={handleCreateSlot}
            currentWeekStart={currentWeekStart}
            onWeekChange={setCurrentWeekStart}
          />
        )}

        {/* Quick tip */}
        <div className="mt-4 text-center text-sm text-gray-500">
          Tip: Click on a slot to edit or copy the broadcast link
        </div>
      </div>

      {/* Slot Modal */}
      <SlotModal
        slot={selectedSlot}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSave={handleSaveSlot}
        onDelete={handleDeleteSlot}
        initialStartTime={newSlotTimes?.start}
        initialEndTime={newSlotTimes?.end}
      />
    </div>
  );
}
