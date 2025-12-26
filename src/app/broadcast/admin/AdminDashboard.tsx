'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole, isBroadcaster } from '@/hooks/useUserRole';
import { useBroadcasterSettings } from '@/hooks/useBroadcasterSettings';
import { BroadcastSlotSerialized, RoomStatus, BroadcastType, DJSlot } from '@/types/broadcast';
import { WeeklyCalendar } from '@/components/broadcast/admin/WeeklyCalendar';
import { SlotModal } from '@/components/broadcast/admin/SlotModal';
import { getSlots, createSlot, deleteSlot as deleteSlotFromDb, updateSlot } from '@/lib/broadcast-slots';
import { BroadcastHeader } from '@/components/BroadcastHeader';
import { AuthModal } from '@/components/AuthModal';

// Channel app deep link for the broadcast station
const CHANNEL_BROADCAST_URL = 'https://channel-app.com/listen/broadcast';

// Channel App URL Section Component
function ChannelAppUrlSection() {
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(CHANNEL_BROADCAST_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error('Failed to copy');
    }
  };

  return (
    <div className="bg-[#252525] rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-gray-400 text-sm mb-1">Channel Broadcast URL</label>
          <p className="text-gray-500 text-xs">Share this link to listen in the Channel app</p>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={CHANNEL_BROADCAST_URL}
            className="w-80 bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-2 font-mono text-sm"
          />
          <button
            onClick={copyUrl}
            className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors text-sm"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const { settings: broadcasterSettings, loading: settingsLoading } = useBroadcasterSettings(user);

  const [slots, setSlots] = useState<BroadcastSlotSerialized[]>([]);
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Calendar state
  const [currentWeekStart, setCurrentWeekStart] = useState(getWeekStart());

  // Modal state
  const [selectedSlot, setSelectedSlot] = useState<BroadcastSlotSerialized | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newSlotTimes, setNewSlotTimes] = useState<{ start: Date; end: Date } | null>(null);

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
          venueSlug: broadcasterSettings.venueSlug,
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
        venueSlug: broadcasterSettings.venueSlug,
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
  if (authLoading || roleLoading || settingsLoading) {
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
    const handleEmailContinue = async () => {
      if (!email.trim()) return;
      const methods = await checkEmailMethods(email.trim());
      setIsNewUser(methods.length === 0);
      setAuthView('methodChoice');
    };

    const handlePasswordSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setAuthError('');
      if (isNewUser) {
        if (password !== confirmPassword) {
          setAuthError('Passwords don\'t match');
          return;
        }
        if (password.length < 6) {
          setAuthError('Password must be at least 6 characters');
          return;
        }
        await createAccountWithPassword(email.trim(), password);
      } else {
        await signInWithPassword(email.trim(), password);
      }
    };

    const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim()) return;
      await sendPasswordReset(email.trim());
    };

    const resetAuthView = () => {
      setAuthView('main');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setAuthError('');
      resetEmailSent();
      resetPasswordResetSent();
    };

    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <BroadcastHeader />
        <div className="flex items-center justify-center p-8" style={{ minHeight: 'calc(100vh - 60px)' }}>
        <div className="bg-[#252525] rounded-xl p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold text-white mb-2 text-center">
            {authView === 'forgotPassword' ? 'Reset Password' : 'Sign In'}
          </h1>
          {authView === 'main' && (
            <p className="text-gray-400 mb-6 text-center">
              Sign in to manage your radio station broadcasts.
            </p>
          )}

          {/* Password reset sent */}
          {passwordResetSent ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-white mb-2">Check your email</p>
              <p className="text-gray-400 text-sm mb-4">We sent a password reset link to {email}</p>
              <button onClick={resetAuthView} className="text-blue-400 hover:text-blue-300 text-sm">
                Back to sign in
              </button>
            </div>
          ) : emailSent ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-white mb-2">Check your email</p>
              <p className="text-gray-400 text-sm mb-4">We sent a sign-in link to your email address.</p>
              <button onClick={resetAuthView} className="text-blue-400 hover:text-blue-300 text-sm">
                Use a different method
              </button>
            </div>
          ) : authView === 'main' ? (
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

              {/* Email Sign In */}
              <button
                onClick={() => setAuthView('emailInput')}
                className="w-full bg-transparent border border-gray-600 hover:border-gray-500 text-white font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-3"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Continue with Email
              </button>

              {/* Forgot password link */}
              <button
                onClick={() => setAuthView('forgotPassword')}
                className="w-full text-gray-500 hover:text-white text-sm transition-colors"
              >
                Forgot password?
              </button>
            </div>
          ) : authView === 'emailInput' ? (
            <div className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                autoFocus
              />
              <button
                onClick={handleEmailContinue}
                disabled={!email.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
              >
                Continue
              </button>
              <button onClick={resetAuthView} className="w-full text-gray-500 hover:text-white text-sm">
                Back
              </button>
            </div>
          ) : authView === 'methodChoice' ? (
            <div className="space-y-4">
              <p className="text-gray-400 text-sm text-center mb-4">{email}</p>
              <button
                onClick={handleEmailSignIn}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-3"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Send sign-in link
              </button>
              <button
                onClick={() => setAuthView('password')}
                className="w-full bg-transparent border border-gray-600 hover:border-gray-500 text-white font-medium py-3 px-6 rounded-lg transition-colors flex flex-col items-center gap-1"
              >
                <span className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Enter password manually
                </span>
                <span className="text-xs text-gray-500">Recommended if using a shared computer</span>
              </button>
              <button
                onClick={() => setAuthView('forgotPassword')}
                className="w-full text-gray-500 hover:text-white text-sm transition-colors"
              >
                Forgot password?
              </button>
              <button onClick={() => setAuthView('emailInput')} className="w-full text-gray-500 hover:text-white text-sm">
                Back
              </button>
            </div>
          ) : authView === 'password' ? (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <p className="text-gray-400 text-sm text-center">{email}</p>
              {isNewUser && <p className="text-gray-500 text-xs text-center">Create a password for your new account</p>}
              {authError && <p className="text-red-400 text-sm text-center">{authError}</p>}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                autoFocus
              />
              {isNewUser && (
                <>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-gray-500 text-xs">Password must be at least 6 characters</p>
                </>
              )}
              <button
                type="submit"
                disabled={!password || (isNewUser && password !== confirmPassword)}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
              >
                {isNewUser ? 'Create Account' : 'Sign In'}
              </button>
              <button
                type="button"
                onClick={() => setAuthView('forgotPassword')}
                className="w-full text-gray-500 hover:text-white text-sm transition-colors"
              >
                Forgot password?
              </button>
              <button type="button" onClick={() => setAuthView('methodChoice')} className="w-full text-gray-500 hover:text-white text-sm">
                Back
              </button>
            </form>
          ) : authView === 'forgotPassword' ? (
            <form onSubmit={handleForgotPasswordSubmit} className="space-y-4">
              <p className="text-gray-400 text-sm text-center mb-4">
                Enter your email and we&apos;ll send you a link to reset your password.
              </p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                autoFocus
              />
              <button
                type="submit"
                disabled={!email.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
              >
                Send Reset Link
              </button>
              <button type="button" onClick={resetAuthView} className="w-full text-gray-500 hover:text-white text-sm">
                Back to sign in
              </button>
            </form>
          ) : null}

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
    <div className="min-h-screen bg-[#1a1a1a] text-white">
      <BroadcastHeader />
      <div className="p-4 md:p-8">
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

        {/* Channel App URL */}
        <ChannelAppUrlSection />

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
            venueSlug={broadcasterSettings.venueSlug}
          />
        )}

        {/* Quick tip */}
        <div className="mt-4 text-center text-sm text-gray-500">
          Tip: Click to edit, right-click to copy link. Drag edges to resize.
        </div>
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
