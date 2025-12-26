'use client';

/**
 * DJ Profile Setup Component
 *
 * USERNAME RULES:
 * ===============
 * | DJ Type                    | Can edit username? | Saved to profile? |
 * |----------------------------|-------------------|-------------------|
 * | Venue DJ (single/multi)    | ✓ Yes             | ✗ No (ephemeral)  |
 * | Remote DJ (logged in)      | ✗ No - locked     | Uses chatUsername |
 * | Remote DJ (guest)          | ✓ Yes             | ✗ No (ephemeral)  |
 *
 * WHY:
 * - Venue DJs share one computer, each types their own name (ephemeral)
 * - Remote DJs who log in should use their persistent Channel username
 * - This keeps chat identity consistent across the platform
 *
 * DETECTION:
 * - broadcastType === 'venue' → Venue DJ (permanent URL like /broadcast/bettertomorrow)
 * - broadcastType === 'remote' → Remote DJ (token-based URL like /broadcast/live?token=xxx)
 */

import { useState, useEffect } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';

interface DJProfileSetupProps {
  defaultUsername?: string;
  broadcastType?: 'venue' | 'remote';
  onComplete: (username: string, promoUrl?: string, promoTitle?: string) => void;
}

export function DJProfileSetup({ defaultUsername, broadcastType, onComplete }: DJProfileSetupProps) {
  const { user, isAuthenticated, signInWithGoogle, signInWithApple, sendEmailLink, emailSent, resetEmailSent, loading: authLoading } = useAuthContext();
  const { chatUsername: savedUsername, loading: profileLoading } = useUserProfile(user?.uid);
  const [username, setUsername] = useState(defaultUsername || '');
  const [promoUrl, setPromoUrl] = useState('');
  const [promoTitle, setPromoTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');

  // Remote DJs who are logged in with a chatUsername have their username locked
  // Venue DJs can always change their display name (ephemeral, shared computer)
  const isRemoteDj = broadcastType === 'remote';
  const isUsernameLocked = isAuthenticated && !!savedUsername && isRemoteDj;

  // Pre-fill username from saved chatUsername - this takes PRIORITY over defaultUsername
  // When a logged-in DJ goes live, their chatUsername becomes their DJ username
  useEffect(() => {
    if (savedUsername) {
      setUsername(savedUsername);
    }
  }, [savedUsername]);

  // Get valid username for saving during sign-in (if valid)
  const getValidUsername = (): string | undefined => {
    const trimmed = username.trim();
    if (trimmed.length < 2 || trimmed.length > 20) return undefined;
    if (!/^[A-Za-z0-9]+$/.test(trimmed)) return undefined;
    const reserved = ['channel', 'admin', 'system', 'moderator', 'mod'];
    if (reserved.includes(trimmed.toLowerCase())) return undefined;
    return trimmed;
  };

  const handleGoogleLogin = async () => {
    setIsSigningIn(true);
    try {
      // Pass the DJ username to save it to the user's profile
      await signInWithGoogle(false, getValidUsername());
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleAppleLogin = async () => {
    setIsSigningIn(true);
    try {
      // Pass the DJ username to save it to the user's profile
      await signInWithApple(false, getValidUsername());
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

  // Auto-fill username from user's display name or email (only if no saved username)
  useEffect(() => {
    // Don't auto-fill if user has a saved chatUsername or we're still loading
    if (savedUsername || profileLoading) return;

    if (user && !username) {
      // Try to get a good default username
      const displayName = user.displayName;
      const email = user.email;

      if (displayName) {
        // Clean displayName to be alphanumeric only
        const cleaned = displayName.replace(/[^A-Za-z0-9]/g, '');
        if (cleaned.length >= 2) {
          setUsername(cleaned.slice(0, 20));
          return;
        }
      }

      if (email) {
        // Use part before @ as username
        const emailPrefix = email.split('@')[0].replace(/[^A-Za-z0-9]/g, '');
        if (emailPrefix.length >= 2) {
          setUsername(emailPrefix.slice(0, 20));
        }
      }
    }
  }, [user, username, savedUsername, profileLoading]);

  const validateUsername = (value: string): string | null => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      return 'Username must be at least 2 characters';
    }
    if (trimmed.length > 20) {
      return 'Username must be 20 characters or less';
    }
    if (!/^[A-Za-z0-9]+$/.test(trimmed)) {
      return 'Username can only contain letters and numbers';
    }
    const reserved = ['channel', 'admin', 'system', 'moderator', 'mod'];
    if (reserved.includes(trimmed.toLowerCase())) {
      return 'This username is reserved';
    }
    return null;
  };

  const validateUrl = (value: string): string | null => {
    if (!value) return null; // Optional field
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return 'URL must start with http:// or https://';
      }
      if (value.length > 500) {
        return 'URL is too long';
      }
    } catch {
      return 'Invalid URL format';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate username
    const usernameError = validateUsername(username);
    if (usernameError) {
      setError(usernameError);
      return;
    }

    // Validate promo URL if provided
    const urlError = validateUrl(promoUrl);
    if (urlError) {
      setError(urlError);
      return;
    }

    // Validate promo title if provided
    if (promoTitle && promoTitle.length > 100) {
      setError('Title must be 100 characters or less');
      return;
    }

    // No API call needed - username will be saved when going live
    // This allows the flow to work without Firebase Admin SDK
    onComplete(username.trim(), promoUrl || undefined, promoTitle || undefined);
  };

  // Show loading state while fetching user profile
  if (isAuthenticated && profileLoading) {
    return (
      <div className="bg-[#252525] rounded-xl p-8 max-w-md mx-auto">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-gray-400"></div>
          <span className="ml-3 text-gray-400">Loading your profile...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#252525] rounded-xl p-8 max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-white mb-2">
        Your DJ Profile
      </h2>
      <p className="text-gray-400 mb-8">
        Set up your chat identity for this broadcast.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Username - locked for logged-in remote DJs, editable for venue DJs and guests */}
        <div>
          <label htmlFor="username" className="block text-gray-400 text-sm mb-2">
            Chat username {!isUsernameLocked && <span className="text-red-400">*</span>}
          </label>
          {isUsernameLocked ? (
            // Read-only for logged-in remote DJs
            <div className="w-full bg-gray-800/50 text-white border border-gray-700 rounded-lg px-4 py-3">
              {savedUsername}
            </div>
          ) : (
            // Editable for venue DJs and guests
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="YourDJName"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-gray-500"
              maxLength={20}
              required
            />
          )}
          <p className="text-gray-500 text-xs mt-1">
            {isUsernameLocked
              ? 'This is your Channel username'
              : '2-20 characters, letters and numbers only'
            }
          </p>
        </div>

        {/* Non-blocking login prompt for guests */}
        {!isAuthenticated && (
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            {emailSent ? (
              // Email sent success state
              <div className="text-center">
                <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-gray-300 text-sm font-medium mb-1">Check your email</p>
                <p className="text-gray-500 text-xs mb-3">
                  We sent a sign-in link to <span className="text-white">{email}</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    resetEmailSent();
                    setShowEmailForm(false);
                    setEmail('');
                  }}
                  className="text-gray-400 text-xs underline hover:text-gray-300"
                >
                  Use a different method
                </button>
              </div>
            ) : showEmailForm ? (
              // Email form
              <div>
                <p className="text-gray-300 text-sm mb-3">
                  Sign in with email
                </p>
                <form onSubmit={handleEmailSubmit} className="flex gap-2 mb-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    autoFocus
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gray-500"
                  />
                  <button
                    type="submit"
                    disabled={isSigningIn || authLoading || !email.trim()}
                    className="bg-white hover:bg-gray-100 disabled:bg-gray-300 text-gray-900 text-sm font-medium py-2 px-3 rounded-lg transition-colors"
                  >
                    {isSigningIn ? '...' : 'Send'}
                  </button>
                </form>
                <button
                  type="button"
                  onClick={() => setShowEmailForm(false)}
                  className="text-gray-400 text-xs underline hover:text-gray-300"
                >
                  Back to sign-in options
                </button>
              </div>
            ) : (
              // Default sign-in options
              <div>
                <p className="text-gray-300 text-sm mb-3">
                  Already on Channel? Log in to load your profile.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isSigningIn || authLoading}
                    className="flex-1 flex items-center justify-center gap-2 bg-white hover:bg-gray-100 disabled:bg-gray-300 text-gray-900 text-sm font-medium py-2 px-3 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    {isSigningIn ? '...' : 'Google'}
                  </button>
                  <button
                    type="button"
                    onClick={handleAppleLogin}
                    disabled={isSigningIn || authLoading}
                    className="flex-1 flex items-center justify-center gap-2 bg-black hover:bg-gray-800 disabled:bg-gray-700 text-white text-sm font-medium py-2 px-3 rounded-lg border border-gray-600 transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                    </svg>
                    {isSigningIn ? '...' : 'Apple'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEmailForm(true)}
                    disabled={isSigningIn || authLoading}
                    className="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white text-sm font-medium py-2 px-3 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    {isSigningIn ? '...' : 'Email'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Promo Link (Optional) */}
        <div>
          <label htmlFor="promoUrl" className="block text-gray-400 text-sm mb-2">
            Promo link <span className="text-gray-600">(optional)</span>
          </label>
          <input
            id="promoUrl"
            type="url"
            value={promoUrl}
            onChange={(e) => setPromoUrl(e.target.value)}
            placeholder="https://bandcamp.com/your-album"
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-gray-500"
          />
          <p className="text-gray-500 text-xs mt-1">
            Share a link to your music, merch, or tickets
          </p>
        </div>

        {/* Promo Title (Optional) */}
        {promoUrl && (
          <div>
            <label htmlFor="promoTitle" className="block text-gray-400 text-sm mb-2">
              Link title <span className="text-gray-600">(optional)</span>
            </label>
            <input
              id="promoTitle"
              type="text"
              value={promoTitle}
              onChange={(e) => setPromoTitle(e.target.value)}
              placeholder="New album out now!"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-gray-500"
              maxLength={100}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={!username.trim()}
          className="w-full bg-accent hover:bg-accent-hover disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition-colors"
        >
          Continue to Go Live
        </button>
      </form>
    </div>
  );
}
