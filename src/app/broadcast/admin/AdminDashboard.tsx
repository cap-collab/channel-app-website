'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole, isBroadcaster } from '@/hooks/useUserRole';
import { useBroadcasterSettings } from '@/hooks/useBroadcasterSettings';
import { BroadcastSlotSerialized, RoomStatus, BroadcastType, DJSlot } from '@/types/broadcast';
import { WeeklyCalendar } from '@/components/broadcast/admin/WeeklyCalendar';
import { SlotModal } from '@/components/broadcast/admin/SlotModal';
import { getSlots, createSlot, deleteSlot as deleteSlotFromDb, updateSlot } from '@/lib/broadcast-slots';

// Get start of current week (Sunday)
function getWeekStart(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function AdminDashboard() {
  const { user, isAuthenticated, loading: authLoading, signInWithGoogle, signInWithApple, sendEmailLink, emailSent, resetEmailSent, signOut } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);
  const { settings: broadcasterSettings, loading: settingsLoading } = useBroadcasterSettings(user);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const [slots, setSlots] = useState<BroadcastSlotSerialized[]>([]);
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState('');

  // Calendar state
  const [currentWeekStart, setCurrentWeekStart] = useState(getWeekStart());

  // Modal state
  const [selectedSlot, setSelectedSlot] = useState<BroadcastSlotSerialized | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newSlotTimes, setNewSlotTimes] = useState<{ start: Date; end: Date } | null>(null);

  // Check if user has broadcaster access
  const hasBroadcasterAccess = isBroadcaster(role);

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
      Promise.all([fetchSlots(), fetchRoomStatus()]).finally(() => setIsLoading(false));

      // Poll room status every 10 seconds
      const interval = setInterval(fetchRoomStatus, 10000);
      return () => clearInterval(interval);
    } else {
      setIsLoading(false);
    }
  }, [isAuthenticated, hasBroadcasterAccess, fetchSlots, fetchRoomStatus]);

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
      // Update existing slot - delete and recreate
      await deleteSlotFromDb(selectedSlot.id);
    }

    // Create new slot
    await createSlot({
      ...data,
      createdBy: user.uid,
      venueSlug: broadcasterSettings.venueSlug,
    });

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

  // Handle email sign in
  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      await sendEmailLink(email);
    }
  };

  // Auth or role loading
  if (authLoading || roleLoading || settingsLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    );
  }

  // Not authenticated - show sign in options
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-8">
        <div className="bg-gray-900 rounded-xl p-8 max-w-md w-full">
          <div className="flex justify-center mb-6">
            <Image
              src="/logo-white.svg"
              alt="CHANNEL"
              width={140}
              height={28}
              className="h-7 w-auto"
              priority
            />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2 text-center">Channel Broadcast</h1>
          <p className="text-gray-400 mb-6 text-center">
            Sign in to manage your radio station broadcasts.
          </p>

          {emailSent ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-white mb-2">Check your email</p>
              <p className="text-gray-400 text-sm mb-4">We sent a sign-in link to your email address.</p>
              <button
                onClick={resetEmailSent}
                className="text-blue-400 hover:text-blue-300 text-sm"
              >
                Use a different method
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Google Sign In */}
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
                Continue with Google
              </button>

              {/* Apple Sign In */}
              <button
                onClick={() => signInWithApple()}
                className="w-full bg-white hover:bg-gray-100 text-black font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-3"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
                Continue with Apple
              </button>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-700"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-gray-900 text-gray-500">or</span>
                </div>
              </div>

              {/* Email Sign In */}
              <form onSubmit={handleEmailSignIn} className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  required
                />
                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
                >
                  Continue with Email
                </button>
              </form>
            </div>
          )}
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
    );
  }

  // Not a broadcaster
  if (!hasBroadcasterAccess) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-8">
        <div className="bg-gray-900 rounded-xl p-8 max-w-md text-center">
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
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl md:text-3xl font-bold">Broadcast Schedule</h1>

          <div className="flex items-center gap-4">
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

            {/* Profile menu */}
            <div className="relative">
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="w-10 h-10 rounded-full bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-colors"
              >
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt="Profile"
                    className="w-10 h-10 rounded-full"
                  />
                ) : (
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                )}
              </button>

              {showProfileMenu && (
                <>
                  {/* Backdrop to close menu */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowProfileMenu(false)}
                  />
                  {/* Dropdown menu */}
                  <div className="absolute right-0 mt-2 w-48 bg-gray-800 rounded-lg shadow-lg border border-gray-700 z-50">
                    <div className="px-4 py-3 border-b border-gray-700">
                      <p className="text-sm text-white truncate">{user?.email}</p>
                    </div>
                    <button
                      onClick={async () => {
                        await signOut();
                        window.location.href = '/';
                      }}
                      className="w-full px-4 py-3 text-left text-red-400 hover:bg-gray-700 rounded-b-lg transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
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
            onUpdateSlot={handleUpdateSlotTimes}
            currentWeekStart={currentWeekStart}
            onWeekChange={setCurrentWeekStart}
            venueName={broadcasterSettings.venueName}
          />
        )}

        {/* Quick tip */}
        <div className="mt-4 text-center text-sm text-gray-500">
          Tip: Click on a slot to edit or copy the broadcast link. Drag the edges to resize.
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
        venueName={broadcasterSettings.venueName}
        venueSlug={broadcasterSettings.venueSlug}
      />
    </div>
  );
}
