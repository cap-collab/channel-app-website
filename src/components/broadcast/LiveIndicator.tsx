'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { BroadcastSlotSerialized } from '@/types/broadcast';
import { DJChatPanel } from './DJChatPanel';
import { useAuthContext } from '@/contexts/AuthContext';

// Channel app deep link for the broadcast station
const CHANNEL_BROADCAST_URL = 'https://channel-app.com/listen/broadcast';
// Channel app download URL
const CHANNEL_APP_DOWNLOAD_URL = 'https://channel-app.com/download';

interface LiveIndicatorProps {
  slot: BroadcastSlotSerialized | null;
  hlsUrl: string | null;
  onEndBroadcast: () => void;
  broadcastToken?: string;
  djUsername?: string;
  initialPromoSubmitted?: boolean;
  isVenue?: boolean;
  onChangeUsername?: (newUsername: string) => void;
}

// Helper to format time
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Helper to format date
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function LiveIndicator({ slot, onEndBroadcast, broadcastToken, djUsername, initialPromoSubmitted, isVenue = false, onChangeUsername }: LiveIndicatorProps) {
  const { user, isAuthenticated, signInWithGoogle, signInWithApple, sendEmailLink, emailSent, resetEmailSent, loading: authLoading } = useAuthContext();
  const [copied, setCopied] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isEnding, setIsEnding] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');

  const handleGoogleLogin = async () => {
    setIsSigningIn(true);
    try {
      // Pass the DJ username to save it to the user's profile
      await signInWithGoogle(false, djUsername);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleAppleLogin = async () => {
    setIsSigningIn(true);
    try {
      // Pass the DJ username to save it to the user's profile
      await signInWithApple(false, djUsername);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsSigningIn(true);
    try {
      await sendEmailLink(email.trim(), false);
    } finally {
      setIsSigningIn(false);
    }
  };

  // Duration counter and time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setDuration(prev => prev + 1);
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const copyChannelUrl = async () => {
    try {
      await navigator.clipboard.writeText(CHANNEL_BROADCAST_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error('Failed to copy');
    }
  };

  const handleEndBroadcast = async () => {
    setIsEnding(true);
    onEndBroadcast();
  };

  // Calculate time remaining if we have a slot
  const getTimeRemaining = () => {
    if (!slot) return null;

    const remaining = slot.endTime - now;

    if (remaining <= 0) return 'Overtime';

    const mins = Math.floor(remaining / 60000);
    if (mins < 60) return `${mins}m remaining`;

    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m remaining`;
  };

  const fifteenMin = 15 * 60 * 1000;

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:h-[calc(100vh-4rem)]">
      {/* Left Column - Show info and controls */}
      <div className="flex-1 space-y-4 lg:overflow-y-auto">
        {/* Station Header (like iOS NowPlayingBar) */}
        <div className="bg-gray-900 rounded-xl p-4">
          <div className="flex items-center gap-3">
            {/* Station logo - square app icon */}
            <Image
              src="/apple-touch-icon.png"
              alt="Channel"
              width={48}
              height={48}
              className="rounded-lg flex-shrink-0"
            />
            {/* Station and show info */}
            <div className="flex-1 min-w-0">
              <h2 className="text-white font-semibold text-base">Channel Broadcast</h2>
              {slot && (
                <p className="text-gray-400 text-sm truncate">{slot.showName || 'Live'}</p>
              )}
            </div>
          </div>
        </div>

        {/* Show Schedule */}
        {slot && (slot.djSlots?.length || slot.djName) && (
          <div className="bg-gray-900 rounded-xl p-4">
            <p className="text-gray-500 text-sm mb-3">
              {formatDate(slot.startTime)} · {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
            </p>

            {slot.djSlots && slot.djSlots.length > 0 ? (
              <div className="space-y-2">
                {slot.djSlots.map((dj, i) => {
                  const isOnNow = dj.startTime <= now && dj.endTime > now;
                  const isUpSoon = !isOnNow && dj.startTime > now && (dj.startTime - now) < fifteenMin;
                  const minutesUntil = Math.ceil((dj.startTime - now) / 60000);

                  return (
                    <div key={i} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-3">
                        <span className="text-white">{dj.djName || 'TBD'}</span>
                        <span className="text-gray-500 text-sm">
                          {formatTime(dj.startTime)} – {formatTime(dj.endTime)}
                        </span>
                      </div>
                      {isOnNow && (
                        <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full font-medium">
                          ON NOW
                        </span>
                      )}
                      {isUpSoon && (
                        <span className="text-xs bg-yellow-600 text-white px-2 py-0.5 rounded-full font-medium">
                          UP IN {minutesUntil} MIN
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : slot.djName ? (
              <div className="flex items-center justify-between py-1">
                <span className="text-white">{slot.djName}</span>
                {slot.startTime <= now && slot.endTime > now && (
                  <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full font-medium">
                    ON NOW
                  </span>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Live Status Card */}
        <div className="bg-gray-900 rounded-xl p-6">
          {/* Live badge and duration */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-red-600 px-3 py-1 rounded-full">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                <span className="text-white font-bold text-sm">LIVE</span>
              </div>
              <span className="text-white font-mono text-lg">{formatDuration(duration)}</span>
            </div>

            {slot && (
              <div className="text-right">
                <p className="text-gray-400 text-sm">{getTimeRemaining()}</p>
              </div>
            )}
          </div>

          {/* Channel App URL */}
          <div className="mb-6">
            <label className="block text-gray-400 text-sm mb-2">Listen in Channel</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={CHANNEL_BROADCAST_URL}
                className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm"
              />
              <button
                onClick={copyChannelUrl}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-3 rounded-lg transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-gray-500 text-xs mt-2">
              Share this link to open your broadcast in the Channel app
            </p>
          </div>

          {/* End broadcast button */}
          <button
            onClick={handleEndBroadcast}
            disabled={isEnding}
            className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition-colors"
          >
            {isEnding ? 'Ending broadcast...' : 'End Broadcast'}
          </button>
        </div>

        {/* Login section - only show when NOT logged in (no dismiss option) */}
        {!isAuthenticated && djUsername && (
          <div className="bg-blue-900/30 border border-blue-500/30 rounded-xl p-4">
            {emailSent ? (
              // Email sent success state
              <div className="text-center">
                <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-blue-200 text-sm font-medium mb-1">Check your email</p>
                <p className="text-blue-300/70 text-xs mb-3">
                  We sent a sign-in link to <span className="text-white">{email}</span>
                </p>
                <button
                  onClick={() => {
                    resetEmailSent();
                    setShowEmailForm(false);
                    setEmail('');
                  }}
                  className="text-blue-400 text-xs underline hover:text-blue-300"
                >
                  Use a different method
                </button>
              </div>
            ) : showEmailForm ? (
              // Email form
              <form onSubmit={handleEmailSubmit}>
                <p className="text-blue-200 text-sm font-medium mb-3">
                  Sign in with email
                </p>
                <div className="flex gap-2 mb-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    autoFocus
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="submit"
                    disabled={isSigningIn || authLoading || !email.trim()}
                    className="bg-white hover:bg-gray-100 disabled:bg-gray-300 text-gray-900 text-xs font-medium py-2 px-3 rounded-lg transition-colors"
                  >
                    {isSigningIn ? '...' : 'Send'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEmailForm(false)}
                  className="text-blue-400 text-xs underline hover:text-blue-300"
                >
                  Back to sign-in options
                </button>
              </form>
            ) : (
              // Default login options
              <div>
                <p className="text-blue-200 text-sm font-medium mb-1">
                  Chat on mobile, save your settings for next time
                </p>
                <p className="text-blue-300/70 text-xs mb-3">
                  Log in to link your account to the Channel app.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleGoogleLogin}
                    disabled={isSigningIn || authLoading}
                    className="flex items-center gap-1.5 bg-white hover:bg-gray-100 disabled:bg-gray-300 text-gray-900 text-xs font-medium py-1.5 px-3 rounded-lg transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    {isSigningIn ? '...' : 'Google'}
                  </button>
                  <button
                    onClick={handleAppleLogin}
                    disabled={isSigningIn || authLoading}
                    className="flex items-center gap-1.5 bg-black hover:bg-gray-800 disabled:bg-gray-700 text-white text-xs font-medium py-1.5 px-3 rounded-lg border border-gray-600 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                    </svg>
                    {isSigningIn ? '...' : 'Apple'}
                  </button>
                  <button
                    onClick={() => setShowEmailForm(true)}
                    disabled={isSigningIn || authLoading}
                    className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Email
                  </button>
                  <a
                    href={CHANNEL_APP_DOWNLOAD_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors"
                  >
                    Get the app
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Column - Chat (on desktop, takes fixed width and full height) */}
      {broadcastToken && djUsername && slot && (
        <div className="lg:w-96 lg:flex-shrink-0 lg:h-full flex flex-col">
          <DJChatPanel
            broadcastToken={broadcastToken}
            slotId={slot.id}
            djUsername={djUsername}
            userId={user?.uid}
            isCollapsed={isChatCollapsed}
            onToggleCollapse={() => setIsChatCollapsed(!isChatCollapsed)}
            initialPromoSubmitted={initialPromoSubmitted}
            isVenue={isVenue}
            onChangeUsername={onChangeUsername}
          />
        </div>
      )}
    </div>
  );
}
