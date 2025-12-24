'use client';

import { useState, useEffect } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';

interface DJProfileSetupProps {
  defaultUsername?: string;
  onComplete: (username: string, promoUrl?: string, promoTitle?: string) => void;
}

export function DJProfileSetup({ defaultUsername, onComplete }: DJProfileSetupProps) {
  const { user } = useAuthContext();
  const [username, setUsername] = useState(defaultUsername || '');
  const [promoUrl, setPromoUrl] = useState('');
  const [promoTitle, setPromoTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Auto-fill username from user's display name or email
  useEffect(() => {
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
  }, [user, username]);

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

  return (
    <div className="bg-gray-900 rounded-xl p-8 max-w-md mx-auto">
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

        {/* Username */}
        <div>
          <label htmlFor="username" className="block text-gray-400 text-sm mb-2">
            Chat username <span className="text-red-400">*</span>
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="YourDJName"
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
            maxLength={20}
            required
          />
          <p className="text-gray-500 text-xs mt-1">
            2-20 characters, letters and numbers only
          </p>
        </div>

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
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
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
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
              maxLength={100}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={!username.trim()}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition-colors"
        >
          Continue to Go Live
        </button>
      </form>
    </div>
  );
}
