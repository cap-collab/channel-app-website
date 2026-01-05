'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole, isBroadcaster } from '@/hooks/useUserRole';
import { BroadcastSlotSerialized, RoomStatus, BroadcastType, DJSlot } from '@/types/broadcast';
import { WeeklyCalendar } from '@/components/broadcast/admin/WeeklyCalendar';
import { SlotModal } from '@/components/broadcast/admin/SlotModal';
import { getSlots, createSlot, deleteSlot as deleteSlotFromDb, updateSlot } from '@/lib/broadcast-slots';
import { BroadcastHeader } from '@/components/BroadcastHeader';
import { AuthModal } from '@/components/AuthModal';
import { DJApplicationsTab } from '@/components/broadcast/admin/DJApplicationsTab';

type AdminTab = 'schedule' | 'applications';

// Get start of current week (Sunday)
function getWeekStart(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function AdminDashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);

  const [slots, setSlots] = useState<BroadcastSlotSerialized[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Calendar state
  const [currentWeekStart, setCurrentWeekStart] = useState(getWeekStart());

  // Modal state
  const [selectedSlot, setSelectedSlot] = useState<BroadcastSlotSerialized | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newSlotTimes, setNewSlotTimes] = useState<{ start: Date; end: Date } | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<AdminTab>('schedule');
  const [applicationCount, setApplicationCount] = useState(0);

  // Check if user has broadcaster access
  const hasBroadcasterAccess = isBroadcaster(role);

  // Complete any expired slots (runs on load)
  const completeExpiredSlots = useCallback(async () => {
    try {
      await fetch('/api/broadcast/complete-expired', { method: 'POST' });
    } catch (error) {
      console.error('Failed to complete expired slots:', error);
    }
  }, []);

  // Fetch slots from Firestore directly
  const fetchSlots = useCallback(async () => {
    try {
      const slotsData = await getSlots();
      setSlots(slotsData);
    } catch (error) {
      console.error('Failed to fetch slots:', error);
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
    if (isAuthenticated && hasBroadcasterAccess) {
      // First complete any expired slots, then fetch fresh data
      completeExpiredSlots()
        .then(() => Promise.all([fetchSlots(), fetchRoomStatus()]))
        .finally(() => setIsLoading(false));

      // Poll room status every 10 seconds
      const interval = setInterval(fetchRoomStatus, 10000);
      return () => clearInterval(interval);
    } else {
      setIsLoading(false);
    }
  }, [isAuthenticated, hasBroadcasterAccess, completeExpiredSlots, fetchSlots, fetchRoomStatus]);

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

  // Save slot (create or update) - directly to Firestore
  const handleSaveSlot = async (data: {
    showName: string;
    djName?: string;
    djSlots?: DJSlot[];
    startTime: number;
    endTime: number;
    broadcastType: BroadcastType;
  }) => {
    if (!user) return;

    if (selectedSlot) {
      // Check if broadcast type changed - if so, need to recreate to get new token
      const typeChanged = selectedSlot.broadcastType !== data.broadcastType;

      if (typeChanged) {
        // Delete old slot and create new one (new type needs new token)
        await deleteSlotFromDb(selectedSlot.id);
        await createSlot({
          ...data,
          createdBy: user.uid,
        });
      } else {
        // Update existing slot - preserve the token by using updateSlot
        await updateSlot(selectedSlot.id, {
          showName: data.showName,
          djName: data.djName,
          djSlots: data.djSlots,
          startTime: data.startTime,
          endTime: data.endTime,
        });
      }
    } else {
      // Create new slot
      await createSlot({
        ...data,
        createdBy: user.uid,
      });
    }

    await fetchSlots();
  };

  // Delete slot - directly from Firestore
  const handleDeleteSlot = async (slotId: string) => {
    await deleteSlotFromDb(slotId);
    await fetchSlots();
  };

  // Update slot times (for drag-to-resize)
  const handleUpdateSlotTimes = async (slotId: string, updates: { startTime?: number; endTime?: number }) => {
    await updateSlot(slotId, updates);
    await fetchSlots();
  };

  // Close modal
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedSlot(null);
    setNewSlotTimes(null);
  };

  // Auth or role loading
  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <BroadcastHeader />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 60px)' }}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      </div>
    );
  }

  // Not authenticated - show sign in options
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <BroadcastHeader />
        <div className="flex flex-col items-center justify-center p-8" style={{ minHeight: 'calc(100vh - 60px)' }}>
          {/* Radio info section */}
          <div className="max-w-xl text-center mb-12">
            <div className="space-y-6 text-gray-400 leading-relaxed">
              <p>
                Channel features a curated selection of independent radio stations across web and mobile.
              </p>
              <p>
                If you run a radio and want to extend your reach beyond your own site, Channel helps you connect with new listeners, activate real-time community chat around your shows, and experiment with direct fan support — all at no cost.
              </p>
              <p>
                We&apos;re selective and intentional about the radios we feature. Channel is built around live moments, culture, and community — not passive listening or ads. If that resonates with how you operate, we&apos;d love to hear from you.
              </p>
              <p className="text-white">
                Reach out to be featured on Channel.
              </p>
            </div>
            <div className="mt-8">
              <a
                href="mailto:info@channel-app.com"
                className="inline-block bg-white text-black px-8 py-3 rounded-xl text-base font-semibold hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(255,255,255,0.15)] transition-all"
              >
                Contact Us
              </a>
            </div>
          </div>

          {/* Sign in section */}
          <div className="bg-[#252525] rounded-xl p-8 max-w-md w-full">
            <AuthModal
              isOpen={true}
              onClose={() => {}}
              message="Sign in to manage your radio station broadcasts."
              inline={true}
            />
            <div className="mt-6 pt-6 border-t border-gray-700 text-center">
              <p className="text-gray-400 text-sm">
                Not on Channel yet?{' '}
                <a href="/apply" className="text-blue-400 hover:text-blue-300">
                  Fill out this form to feature your station
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Not a broadcaster
  if (!hasBroadcasterAccess) {
    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <BroadcastHeader />
        <div className="flex items-center justify-center p-8" style={{ minHeight: 'calc(100vh - 60px)' }}>
        <div className="bg-[#252525] rounded-xl p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-gray-400 mb-4">
            You don&apos;t have broadcaster permissions.
          </p>
          <p className="text-gray-500 text-sm mb-4">
            Signed in as: {user?.email}
          </p>
          <div className="pt-4 border-t border-gray-700">
            <p className="text-gray-400 text-sm">
              <a href="/apply" className="text-blue-400 hover:text-blue-300">
                Fill out this form to feature your station
              </a>
              {' '}or contact{' '}
              <a href="mailto:info@channel-app.com" className="text-blue-400 hover:text-blue-300">
                info@channel-app.com
              </a>
              {' '}for more info.
            </p>
          </div>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <BroadcastHeader />
      <div className="p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          {/* Tabs */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab('schedule')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'schedule'
                  ? 'bg-white text-black'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Schedule
            </button>
            <button
              onClick={() => setActiveTab('applications')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'applications'
                  ? 'bg-white text-black'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              DJ Applications
              {applicationCount > 0 && (
                <span className={`px-2 py-0.5 text-xs rounded-full ${
                  activeTab === 'applications'
                    ? 'bg-black text-white'
                    : 'bg-yellow-500 text-black'
                }`}>
                  {applicationCount}
                </span>
              )}
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === 'schedule' ? (
            <>
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
                  onUpdateSlot={handleUpdateSlotTimes}
                  currentWeekStart={currentWeekStart}
                  onWeekChange={setCurrentWeekStart}
                />
              )}

              {/* Quick tip */}
              <div className="mt-4 text-center text-sm text-gray-500">
                Tip: Click to edit, right-click to copy link. Drag edges to resize.
              </div>
            </>
          ) : (
            <DJApplicationsTab
              userId={user?.uid || ''}
              onPendingCountChange={setApplicationCount}
            />
          )}
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
