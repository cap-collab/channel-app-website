'use client';

import { useState, useCallback } from 'react';
import { useDebouncedCallback } from 'use-debounce';

export interface TaggedDJEntry {
  id: string;
  djName: string;
  email: string;
  userId?: string;
  username?: string;
  isLookingUp?: boolean;
  profileFound?: boolean;
}

interface TaggedDJInputProps {
  taggedDJs: TaggedDJEntry[];
  onChange: (djs: TaggedDJEntry[]) => void;
  maxDJs?: number;
}

export function TaggedDJInput({ taggedDJs, onChange, maxDJs = 10 }: TaggedDJInputProps) {
  const [lookupStates, setLookupStates] = useState<Record<string, boolean>>({});

  // Lookup DJ profile by email
  const lookupDjProfile = useCallback(async (djId: string, email: string) => {
    if (!email || !email.includes('@')) {
      // Clear profile fields if email is invalid
      onChange(taggedDJs.map(dj => {
        if (dj.id !== djId) return dj;
        return {
          ...dj,
          userId: undefined,
          username: undefined,
          profileFound: false,
          isLookingUp: false,
        };
      }));
      return;
    }

    // Set loading state
    setLookupStates(prev => ({ ...prev, [djId]: true }));

    try {
      const res = await fetch(`/api/users/lookup-by-email?email=${encodeURIComponent(email)}`);
      const data = await res.json();

      onChange(taggedDJs.map(dj => {
        if (dj.id !== djId) return dj;
        if (data.found) {
          return {
            ...dj,
            userId: data.djUserId,
            username: data.djUsername,
            profileFound: true,
            isLookingUp: false,
          };
        } else {
          return {
            ...dj,
            userId: undefined,
            username: undefined,
            profileFound: false,
            isLookingUp: false,
          };
        }
      }));
    } catch (error) {
      console.error('Failed to lookup DJ profile:', error);
      onChange(taggedDJs.map(dj => {
        if (dj.id !== djId) return dj;
        return { ...dj, isLookingUp: false, profileFound: false };
      }));
    } finally {
      setLookupStates(prev => ({ ...prev, [djId]: false }));
    }
  }, [taggedDJs, onChange]);

  // Debounced email lookup
  const debouncedLookup = useDebouncedCallback(lookupDjProfile, 500);

  const addDJ = () => {
    if (taggedDJs.length >= maxDJs) return;
    onChange([
      ...taggedDJs,
      {
        id: `dj-${Date.now()}`,
        djName: '',
        email: '',
      },
    ]);
  };

  const removeDJ = (id: string) => {
    onChange(taggedDJs.filter(dj => dj.id !== id));
  };

  const updateDJ = (id: string, field: 'djName' | 'email', value: string) => {
    onChange(taggedDJs.map(dj => {
      if (dj.id !== id) return dj;
      const updated = { ...dj, [field]: value };

      // Trigger email lookup if email changed
      if (field === 'email' && value !== dj.email) {
        debouncedLookup(id, value);
      }

      return updated;
    }));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-gray-400 text-sm">
          Tag other DJs playing
        </label>
        {taggedDJs.length > 0 && (
          <span className="text-gray-500 text-xs">
            {taggedDJs.length}/{maxDJs}
          </span>
        )}
      </div>

      {taggedDJs.length === 0 ? (
        <button
          type="button"
          onClick={addDJ}
          className="w-full py-3 border border-dashed border-gray-700 rounded-lg text-gray-400 hover:border-gray-600 hover:text-gray-300 transition-colors text-sm"
        >
          + Add a DJ
        </button>
      ) : (
        <div className="space-y-2">
          {taggedDJs.map((dj, index) => (
            <div key={dj.id} className="bg-gray-800 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <span className="text-xs text-gray-500 mt-2 w-5">#{index + 1}</span>
                <div className="flex-1 space-y-2">
                  {/* DJ Name (required) */}
                  <input
                    type="text"
                    value={dj.djName}
                    onChange={(e) => updateDJ(dj.id, 'djName', e.target.value)}
                    placeholder="DJ Name *"
                    className="w-full bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
                  />

                  {/* Email (optional) */}
                  <div className="flex items-center gap-2">
                    <input
                      type="email"
                      value={dj.email}
                      onChange={(e) => updateDJ(dj.id, 'email', e.target.value)}
                      placeholder="Email (optional)"
                      className="flex-1 bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
                    />
                    {lookupStates[dj.id] && (
                      <span className="text-xs text-gray-400">Looking up...</span>
                    )}
                    {!lookupStates[dj.id] && dj.profileFound && (
                      <span className="text-xs text-green-400 flex items-center gap-1 whitespace-nowrap">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {dj.username || 'Found'}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => removeDJ(dj.id)}
                  className="p-1 text-gray-500 hover:text-red-400 transition-colors mt-1"
                  title="Remove DJ"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}

          {taggedDJs.length < maxDJs && (
            <button
              type="button"
              onClick={addDJ}
              className="w-full py-2 border border-dashed border-gray-700 rounded-lg text-gray-400 hover:border-gray-600 hover:text-gray-300 transition-colors text-sm"
            >
              + Add another DJ
            </button>
          )}
        </div>
      )}

      <p className="text-gray-500 text-xs">
        Tag DJs who played during this recording. Add their email to link their Channel profile.
      </p>
    </div>
  );
}
