import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { BroadcasterSettings } from '@/types/broadcast';

const DEFAULT_SETTINGS: BroadcasterSettings = {
  venueName: 'Venue',
  venueSlug: 'venue',
};

// Generate URL-safe slug from venue name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '') // Remove spaces and special chars
    .replace(/^-+|-+$/g, '');   // Remove leading/trailing dashes
}

interface UseBroadcasterSettingsResult {
  settings: BroadcasterSettings;
  loading: boolean;
  error: string | null;
}

/**
 * Hook to fetch broadcaster settings from Firestore
 * Settings are stored in the user document under 'broadcasterSettings'
 * Falls back to user's display name or email prefix if no explicit venue name
 */
export function useBroadcasterSettings(user: User | null): UseBroadcasterSettingsResult {
  const [settings, setSettings] = useState<BroadcasterSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSettings() {
      if (!user || !db) {
        setSettings(DEFAULT_SETTINGS);
        setLoading(false);
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));

        let venueName: string | null = null;

        if (userDoc.exists()) {
          const data = userDoc.data();
          // First try explicit broadcasterSettings
          if (data.broadcasterSettings?.venueName) {
            venueName = data.broadcasterSettings.venueName;
          }
        }

        // Fallback: use user's display name or email prefix
        if (!venueName) {
          if (user.displayName) {
            venueName = user.displayName;
          } else if (user.email) {
            // Use part before @ as venue name
            venueName = user.email.split('@')[0];
          }
        }

        if (venueName) {
          const venueSlug = generateSlug(venueName);
          setSettings({
            venueName,
            venueSlug,
          });
        } else {
          setSettings(DEFAULT_SETTINGS);
        }
      } catch (err) {
        console.error('Error fetching broadcaster settings:', err);
        setError('Failed to load venue settings');
        setSettings(DEFAULT_SETTINGS);
      } finally {
        setLoading(false);
      }
    }

    fetchSettings();
  }, [user]);

  return { settings, loading, error };
}
