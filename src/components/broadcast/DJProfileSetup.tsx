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


interface DJProfileSetupProps {
  defaultUsername?: string;
  showName?: string;
  broadcastType?: 'venue' | 'remote' | 'recording' | 'restream';
  isVenueRecording?: boolean;  // For recordings made at a venue (shows venue-specific terms)
  onComplete: (username: string) => void;
}

export function DJProfileSetup({ defaultUsername, showName, broadcastType, isVenueRecording, onComplete }: DJProfileSetupProps) {
  const { user, isAuthenticated } = useAuthContext();
  const { chatUsername: savedUsername, loading: profileLoading } = useUserProfile(user?.uid);
  const [username, setUsername] = useState(defaultUsername || '');
  const [error, setError] = useState<string | null>(null);
  const [permissionsConfirmed, setPermissionsConfirmed] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameCheckError, setUsernameCheckError] = useState<string | null>(null);

  // Remote DJs who are logged in with a chatUsername have their username locked
  // Venue DJs can always change their display name (ephemeral, shared computer)
  // Recording mode behaves like remote (DJ is at home, using their own account)
  const isRemoteDj = broadcastType === 'remote' || broadcastType === 'recording';

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
  // Skip if defaultUsername was provided from the broadcast slot's linked DJ profile
  // or if username is already set (e.g. from slot djName)
  useEffect(() => {
    if (savedUsername && !isVenueBroadcast && !defaultUsername && !username) {
      setUsername(savedUsername);
    }
  }, [savedUsername, isVenueBroadcast, defaultUsername, username]);

  // Sync from default props when they arrive async (e.g. from slot DJ profile fetch)
  // defaultUsername is authoritative (from the slot's linked DJ) — override any prior value
  useEffect(() => {
    if (defaultUsername) setUsername(defaultUsername);
  }, [defaultUsername]);

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
      return 'Artist name must be at least 2 characters';
    }
    if (trimmed.length > 20) {
      return 'Artist name must be 20 characters or less';
    }

    // Must contain at least 2 alphanumeric characters (when spaces removed)
    const handle = trimmed.replace(/\s+/g, '');
    if (handle.length < 2) {
      return 'Artist name must have at least 2 characters (excluding spaces)';
    }

    // Alphanumeric and single spaces only
    if (!/^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(trimmed)) {
      return 'Artist name can only contain letters, numbers, and spaces';
    }

    // Check reserved usernames against normalized handle
    const reserved = ['channel', 'admin', 'system', 'moderator', 'mod'];
    if (reserved.includes(handle.toLowerCase())) {
      return 'This name is reserved';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate username (skip if defaultUsername is set from the broadcast slot)
    if (!defaultUsername) {
      const usernameError = validateUsername(username);
      if (usernameError) {
        setError(usernameError);
        return;
      }
    }

    // For logged-in remote DJs without chatUsername, check username availability
    if (!defaultUsername && needsUsernameCheck) {
      if (checkingUsername) {
        setError('Please wait while we check artist name availability');
        return;
      }
      if (usernameAvailable === false) {
        setError(usernameCheckError || 'Artist name is not available. Please choose another.');
        return;
      }
      if (usernameAvailable === null) {
        // Force a check if not yet checked
        await checkUsernameAvailability(username);
        if (usernameAvailable === false) {
          setError(usernameCheckError || 'Artist name is not available. Please choose another.');
          return;
        }
      }
    }

    // Validate permissions confirmation
    if (!permissionsConfirmed) {
      setError('You must confirm and agree to the Artist Terms');
      return;
    }

    // No API call needed - username will be saved when going live
    // This allows the flow to work without Firebase Admin SDK
    const djName = defaultUsername || username.trim();
    onComplete(djName);
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
      {broadcastType === 'recording' && (
        <h2 className="text-2xl font-bold text-white mb-2">Recording Settings</h2>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* DJ Name - plain text title using the name from the broadcast slot */}
        <h2 className="text-2xl font-bold text-white">
          You are live streaming as <span className="text-accent">{defaultUsername || username.trim() || 'Artist'}</span>
          {showName && (
            <span className="text-gray-400 text-lg font-normal"> for {showName}</span>
          )}
        </h2>

        {/* Broadcast/Recording Permissions Confirmation */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <p className="text-gray-300 text-sm mb-3">
            I confirm that I am the artist (or authorized representative) known as <span className="text-white font-medium">{defaultUsername || username.trim() || 'Artist'}</span>, under whose name this {broadcastType === 'recording' ? 'recording' : 'broadcast'} is being made.
          </p>
          <p className="text-gray-300 text-sm mb-3">
            By starting this {broadcastType === 'recording' ? 'recording' : 'broadcast'}, I represent and warrant that:
          </p>
          <ul className="text-gray-400 text-sm space-y-1 mb-4 ml-4">
            {broadcastType === 'recording' && isVenueRecording ? (
              <>
                <li>• The venue and promoters have authorized this recording.</li>
                <li>• I am responsible for ensuring the recording content complies with venue policies and applicable laws.</li>
                <li>• Channel may use this recording and replay it or make it available on Channel websites and channels.</li>
                <li>• All artists listed on this recording are aware of and consent to being recorded and used by Channel.</li>
              </>
            ) : broadcastType === 'recording' ? (
              <>
                <li>• I am responsible for ensuring the recording content complies with applicable laws.</li>
                <li>• Channel may use this recording and replay it or make it available on Channel websites and radio.</li>
              </>
            ) : (
              <>
                <li>• Channel may record this broadcast and replay it or make it available on Channel websites and channels.</li>
                {broadcastType === 'venue' && (
                  <li>• All artists listed on this broadcast are aware of and consent to being livestreamed, recorded, and used by Channel.</li>
                )}
                <li>• I am responsible for ensuring the livestream complies with applicable laws.</li>
              </>
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
                    Artist Terms
                  </a>
            </span>
          </label>
        </div>

        <button
          type="submit"
          disabled={!(defaultUsername || username.trim()) || !permissionsConfirmed}
          className="w-full bg-accent hover:bg-accent-hover disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition-colors"
        >
          {broadcastType === 'recording' ? 'Continue to Record' : 'Continue to Go Live'}
        </button>

        {/* Support contact */}
        <p className="text-gray-500 text-sm text-center">
          Have any issue? Check the <a href="https://channel-app.com/streaming-guide" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">setup guide</a> or call Cap at 415 316 3109
        </p>
      </form>
    </div>
  );
}
