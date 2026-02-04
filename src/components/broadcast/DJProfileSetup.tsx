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
 * - broadcastType === 'venue' → Venue DJ (at a venue, shared computer)
 * - broadcastType === 'remote' → Remote DJ (from home, personal setup)
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useDebouncedCallback } from 'use-debounce';
import { normalizeUrl } from '@/lib/url';

interface DJProfileSetupProps {
  defaultUsername?: string;
  defaultPromoText?: string;
  defaultPromoHyperlink?: string;
  defaultThankYouMessage?: string;
  broadcastType?: 'venue' | 'remote' | 'recording';
  isVenueRecording?: boolean;  // For recordings made at a venue (shows venue-specific terms)
  onComplete: (username: string, promoText?: string, promoHyperlink?: string, thankYouMessage?: string) => void;
}

export function DJProfileSetup({ defaultUsername, defaultPromoText, defaultPromoHyperlink, defaultThankYouMessage, broadcastType, onComplete }: DJProfileSetupProps) {
  const { user, isAuthenticated, signInWithGoogle, signInWithApple, sendEmailLink, emailSent, resetEmailSent, loading: authLoading } = useAuthContext();
  const { chatUsername: savedUsername, djProfile, loading: profileLoading } = useUserProfile(user?.uid);
  const [username, setUsername] = useState(defaultUsername || '');
  const [promoText, setPromoText] = useState(defaultPromoText || '');
  const [promoHyperlink, setPromoHyperlink] = useState(defaultPromoHyperlink || '');
  const [thankYouMessage, setThankYouMessage] = useState(defaultThankYouMessage || '');
  const [error, setError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [permissionsConfirmed, setPermissionsConfirmed] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameCheckError, setUsernameCheckError] = useState<string | null>(null);

  // Remote DJs who are logged in with a chatUsername have their username locked
  // Venue DJs can always change their display name (ephemeral, shared computer)
  // Recording mode behaves like remote (DJ is at home, using their own account)
  const isRemoteDj = broadcastType === 'remote' || broadcastType === 'recording';
  const isUsernameLocked = isAuthenticated && !!savedUsername && isRemoteDj;

  // Logged-in users who don't have a chatUsername must pick a unique one
  // Venue DJs and guests don't need uniqueness check (ephemeral)
  const needsUsernameCheck = isAuthenticated && !savedUsername && isRemoteDj;

  // Check username availability (debounced)
  const checkUsernameAvailability = useCallback(async (usernameToCheck: string) => {
    if (!needsUsernameCheck || !user?.uid) return;

    const trimmed = usernameToCheck.trim();
    if (trimmed.length < 2) {
      setUsernameAvailable(null);
      setUsernameCheckError(null);
      return;
    }

    setCheckingUsername(true);
    setUsernameCheckError(null);

    try {
      const res = await fetch(
        `/api/chat/check-username?username=${encodeURIComponent(trimmed)}&userId=${user.uid}`
      );
      const data = await res.json();

      if (data.error) {
        setUsernameCheckError(data.error);
        setUsernameAvailable(false);
      } else if (data.available) {
        setUsernameAvailable(true);
        setUsernameCheckError(null);
      } else {
        setUsernameAvailable(false);
        setUsernameCheckError(data.reason || 'Username is not available');
      }
    } catch {
      setUsernameCheckError('Failed to check username');
      setUsernameAvailable(null);
    } finally {
      setCheckingUsername(false);
    }
  }, [needsUsernameCheck, user?.uid]);

  // Debounced version for onChange
  const debouncedCheckUsername = useDebouncedCallback(checkUsernameAvailability, 500);

  // Check username when it changes (for logged-in users without chatUsername)
  useEffect(() => {
    if (needsUsernameCheck && username.trim().length >= 2) {
      debouncedCheckUsername(username);
    } else {
      setUsernameAvailable(null);
      setUsernameCheckError(null);
    }
  }, [username, needsUsernameCheck, debouncedCheckUsername]);

  // Pre-fill from logged-in user's profile - ONLY for remote broadcasts
  // Venue broadcasts use the slot's pre-configured DJ data (passed via defaults)
  const isVenueBroadcast = broadcastType === 'venue';

  // Pre-fill username from saved chatUsername - only for remote broadcasts
  useEffect(() => {
    if (savedUsername && !isVenueBroadcast) {
      setUsername(savedUsername);
    }
  }, [savedUsername, isVenueBroadcast]);

  // Pre-fill promo text/hyperlink and thank you message from logged-in user's DJ profile
  // Only for remote broadcasts (venue uses slot's pre-configured data)
  useEffect(() => {
    if (djProfile && !isVenueBroadcast && !promoText) {
      if (djProfile.promoText) {
        setPromoText(djProfile.promoText);
      }
      if (djProfile.promoHyperlink) {
        setPromoHyperlink(djProfile.promoHyperlink);
      }
      if (djProfile.thankYouMessage) {
        setThankYouMessage(djProfile.thankYouMessage);
      }
    }
  }, [djProfile, promoText, isVenueBroadcast]);

  // Get valid username for saving during sign-in (if valid)
  // Must match validateUsername() validation rules
  const getValidUsername = (): string | undefined => {
    const trimmed = username.trim();
    if (trimmed.length < 2 || trimmed.length > 20) return undefined;
    // Allow alphanumeric and single spaces between words (same as validateUsername)
    if (!/^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(trimmed)) return undefined;
    const reserved = ['channel', 'admin', 'system', 'moderator', 'mod'];
    // Check reserved against handle (spaces removed)
    const handle = trimmed.replace(/\s+/g, '');
    if (reserved.includes(handle.toLowerCase())) return undefined;
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
      return 'DJ name must be at least 2 characters';
    }
    if (trimmed.length > 20) {
      return 'DJ name must be 20 characters or less';
    }

    // Must contain at least 2 alphanumeric characters (when spaces removed)
    const handle = trimmed.replace(/\s+/g, '');
    if (handle.length < 2) {
      return 'DJ name must have at least 2 characters (excluding spaces)';
    }

    // Alphanumeric and single spaces only
    if (!/^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(trimmed)) {
      return 'DJ name can only contain letters, numbers, and spaces';
    }

    // Check reserved usernames against normalized handle
    const reserved = ['channel', 'admin', 'system', 'moderator', 'mod'];
    if (reserved.includes(handle.toLowerCase())) {
      return 'This name is reserved';
    }
    return null;
  };

  const validateUrl = (value: string): string | null => {
    if (!value || !value.trim()) return null; // Optional field
    const normalized = normalizeUrl(value.trim());
    try {
      const url = new URL(normalized);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return 'URL must start with http:// or https://';
      }
      if (normalized.length > 500) {
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

    // For logged-in remote DJs without chatUsername, check username availability
    if (needsUsernameCheck) {
      if (checkingUsername) {
        setError('Please wait while we check DJ name availability');
        return;
      }
      if (usernameAvailable === false) {
        setError(usernameCheckError || 'DJ name is not available. Please choose another.');
        return;
      }
      if (usernameAvailable === null) {
        // Force a check if not yet checked
        await checkUsernameAvailability(username);
        if (usernameAvailable === false) {
          setError(usernameCheckError || 'DJ name is not available. Please choose another.');
          return;
        }
      }
    }

    // Validate promo text if provided
    if (promoText && promoText.length > 200) {
      setError('Promo text must be 200 characters or less');
      return;
    }

    // Validate promo hyperlink if provided
    const urlError = validateUrl(promoHyperlink);
    if (urlError) {
      setError(urlError);
      return;
    }

    // Validate permissions confirmation
    if (!permissionsConfirmed) {
      setError('You must confirm and agree to the DJ Terms');
      return;
    }

    // No API call needed - username will be saved when going live
    // This allows the flow to work without Firebase Admin SDK
    const normalizedHyperlink = promoHyperlink ? normalizeUrl(promoHyperlink) : undefined;
    onComplete(username.trim(), promoText.trim() || undefined, normalizedHyperlink, thankYouMessage.trim() || undefined);
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
        {broadcastType === 'recording' ? 'Recording Settings' : 'Your DJ Profile'}
      </h2>
      <p className="text-gray-400 mb-8">
        Enter your DJ name for this {broadcastType === 'recording' ? 'recording' : 'broadcast'}.
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
            DJ Name {!isUsernameLocked && <span className="text-red-400">*</span>}
          </label>
          {isUsernameLocked ? (
            // Read-only for logged-in remote DJs with existing chatUsername
            <div className="w-full bg-gray-800/50 text-white border border-gray-700 rounded-lg px-4 py-3">
              {savedUsername}
            </div>
          ) : (
            // Editable for venue DJs, guests, and logged-in DJs without chatUsername
            <div className="relative">
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="YourDJName"
                className={`w-full bg-gray-800 text-white border rounded-lg px-4 py-3 focus:outline-none ${
                  needsUsernameCheck && usernameAvailable === false
                    ? 'border-red-500 focus:border-red-500'
                    : needsUsernameCheck && usernameAvailable === true
                    ? 'border-green-500 focus:border-green-500'
                    : 'border-gray-700 focus:border-gray-500'
                }`}
                maxLength={20}
                required
              />
              {/* Username availability indicator for logged-in users */}
              {needsUsernameCheck && username.trim().length >= 2 && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {checkingUsername ? (
                    <div className="w-5 h-5 border-2 border-gray-500 border-t-white rounded-full animate-spin" />
                  ) : usernameAvailable === true ? (
                    <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : usernameAvailable === false ? (
                    <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : null}
                </div>
              )}
            </div>
          )}
          <p className={`text-xs mt-1 ${
            needsUsernameCheck && usernameCheckError ? 'text-red-400' : 'text-gray-500'
          }`}>
            {isUsernameLocked
              ? 'This is your Channel DJ name'
              : needsUsernameCheck && usernameCheckError
              ? usernameCheckError
              : needsUsernameCheck && usernameAvailable
              ? 'DJ name is available!'
              : needsUsernameCheck
              ? 'This will be your DJ name in chat'
              : '2-20 characters, letters, numbers, and spaces'
            }
          </p>
        </div>

        {/* Broadcast/Recording Permissions Confirmation */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <p className="text-gray-300 text-sm mb-3">
            By starting this {broadcastType === 'recording' ? 'recording' : 'broadcast'}, I represent and warrant that:
          </p>
          <ul className="text-gray-400 text-sm space-y-1 mb-4 ml-4">
            {broadcastType === 'venue' && (
              <li>• The venue and promoters have authorized this livestream and any related recording.</li>
            )}
            {broadcastType === 'recording' && (
              <>
                <li>• The venue and promoters have authorized this recording.</li>
                <li>• I am responsible for ensuring the recording content complies with venue policies and applicable laws.</li>
              </>
            )}
            <li>• Channel may {broadcastType === 'recording' ? 'use' : 'record'} this {broadcastType === 'recording' ? 'recording' : 'broadcast'} and replay it or make it available on Channel websites and channels.</li>
            <li>• All DJs listed on this {broadcastType === 'recording' ? 'recording' : 'broadcast'} are aware of and consent to being {broadcastType === 'recording' ? 'recorded' : 'livestreamed, recorded,'} and used by Channel.</li>
            {broadcastType !== 'recording' && (
              <li>• I am responsible for ensuring the livestream complies with venue policies and applicable laws.</li>
            )}
          </ul>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={permissionsConfirmed}
              onChange={(e) => setPermissionsConfirmed(e.target.checked)}
              className="mt-0.5 w-5 h-5 rounded border-gray-600 bg-gray-800 text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-gray-300 text-sm">
              I confirm and agree to the{' '}
              <a
                href="/dj-terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white underline hover:text-gray-300"
              >
                DJ Terms
              </a>
            </span>
          </label>
        </div>

        <button
          type="submit"
          disabled={!username.trim() || !permissionsConfirmed}
          className="w-full bg-accent hover:bg-accent-hover disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition-colors"
        >
          {broadcastType === 'recording' ? 'Continue to Record' : 'Continue to Go Live'}
        </button>

        {/* Promo Text (Optional) */}
        <div>
          <label htmlFor="promoText" className="block text-gray-400 text-sm mb-2">
            Promo text <span className="text-gray-600">(optional)</span>
          </label>
          <input
            id="promoText"
            type="text"
            value={promoText}
            onChange={(e) => setPromoText(e.target.value)}
            placeholder="New album out now!"
            maxLength={200}
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-gray-500"
          />
          <p className="text-gray-500 text-xs mt-1">
            This text appears in chat during your broadcast ({promoText.length}/200)
          </p>
        </div>

        {/* Promo Hyperlink (Optional) */}
        {promoText && (
          <div>
            <label htmlFor="promoHyperlink" className="block text-gray-400 text-sm mb-2">
              Promo hyperlink <span className="text-gray-600">(optional)</span>
            </label>
            <input
              id="promoHyperlink"
              type="text"
              value={promoHyperlink}
              onChange={(e) => setPromoHyperlink(e.target.value)}
              placeholder="bandcamp.com/your-album"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-gray-500"
            />
            <p className="text-gray-500 text-xs mt-1">
              Clicking the promo text will open this link
            </p>
          </div>
        )}

        {/* Thank You Message (Optional) */}
        <div>
          <label htmlFor="thankYouMessage" className="block text-gray-400 text-sm mb-2">
            Thank you message <span className="text-gray-600">(optional)</span>
          </label>
          <textarea
            id="thankYouMessage"
            value={thankYouMessage}
            onChange={(e) => setThankYouMessage(e.target.value)}
            placeholder="Thanks for the tip!"
            rows={2}
            maxLength={200}
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-gray-500 resize-none"
          />
          <p className="text-gray-500 text-xs mt-1">
            Shown to listeners after they tip you ({thankYouMessage.length}/200)
          </p>
        </div>

        {/* Non-blocking login prompt for guests - below Continue button */}
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
                  Log in to receive tips, chat on mobile, and save your settings
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
      </form>
    </div>
  );
}
