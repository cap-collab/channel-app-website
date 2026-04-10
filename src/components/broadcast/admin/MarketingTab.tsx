'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { BroadcastSlotSerialized } from '@/types/broadcast';
import { ShareableShowCardStory } from '@/components/studio/ShareableShowCardStory';

interface MarketingTabProps {
  slots: BroadcastSlotSerialized[];
}

// Resolved DJ info from email lookup
interface DJInfo {
  photoUrl?: string;
  genres?: string[];
  description?: string;
}

type DJInfoCache = Record<string, DJInfo>;

function getCardProps(slot: BroadcastSlotSerialized, djInfoCache: DJInfoCache) {
  let djName = '';
  let imageUrl = slot.showImageUrl;
  let genres = slot.liveDjGenres;
  let description = slot.liveDjDescription;

  const cached = djInfoCache[slot.id];

  if (slot.broadcastType === 'venue' && slot.djSlots?.length) {
    djName = slot.djSlots.length === 1
      ? (slot.djSlots[0].djName || '')
      : slot.djSlots.map(d => d.djName).filter(Boolean).join(' b2b ');
    imageUrl = slot.djSlots[0]?.djPhotoUrl || slot.showImageUrl || cached?.photoUrl;
    if (!description && slot.djSlots[0]?.djBio) description = slot.djSlots[0].djBio;
    if (!description && cached?.description) description = cached.description;
    if (!genres && cached?.genres) genres = cached.genres;
  } else {
    djName = slot.djName || '';
    imageUrl = slot.showImageUrl || slot.liveDjPhotoUrl || cached?.photoUrl;
    genres = slot.liveDjGenres || cached?.genres;
    description = slot.liveDjDescription || cached?.description;
  }

  return {
    showName: slot.showName,
    djName,
    startTime: slot.startTime,
    endTime: slot.endTime,
    imageUrl,
    genres,
    description,
  };
}

function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const input = document.createElement('input');
      input.value = link;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="w-full flex items-center justify-center gap-2 bg-gray-800 text-gray-300 hover:bg-gray-700 font-medium py-2 rounded text-sm transition-colors"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.54a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.34 8.798" />
      </svg>
      {copied ? 'Copied!' : 'Copy broadcast link'}
    </button>
  );
}

export function MarketingTab({ slots }: MarketingTabProps) {
  const [djInfoCache, setDjInfoCache] = useState<DJInfoCache>({});

  // Show today + next 2 days only
  const upcomingSlots = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const threeDaysOut = startOfToday.getTime() + 3 * 86400_000;
    return slots
      .filter(s => {
        if (s.status === 'missed') return false;
        // Must start within today + next 2 days
        if (s.startTime >= startOfToday.getTime() && s.startTime < threeDaysOut) return true;
        return false;
      })
      .sort((a, b) => a.startTime - b.startTime);
  }, [slots]);

  // Group by day
  const groupedByDay = useMemo(() => {
    const groups: [string, BroadcastSlotSerialized[]][] = [];
    const seen = new Map<string, BroadcastSlotSerialized[]>();
    for (const slot of upcomingSlots) {
      const date = new Date(slot.startTime);
      const key = date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
      if (!seen.has(key)) {
        const arr: BroadcastSlotSerialized[] = [];
        seen.set(key, arr);
        groups.push([key, arr]);
      }
      seen.get(key)!.push(slot);
    }
    return groups;
  }, [upcomingSlots]);

  // Look up DJ profiles directly from Firestore by chatUsernameNormalized
  useEffect(() => {
    if (!db) return;

    // Deduplicate by normalized name
    const normalizedToSlotIds: Record<string, string[]> = {};
    for (const s of upcomingSlots) {
      if (djInfoCache[s.id]) continue;
      const name = s.djName;
      if (!name) continue;
      const normalized = name.replace(/[\s-]+/g, '').toLowerCase();
      if (!normalizedToSlotIds[normalized]) normalizedToSlotIds[normalized] = [];
      normalizedToSlotIds[normalized].push(s.id);
    }

    if (Object.keys(normalizedToSlotIds).length === 0) return;
    const firestore = db;
    if (!firestore) return;

    Promise.all(
      Object.entries(normalizedToSlotIds).map(async ([normalized, slotIds]) => {
        try {
          const q = query(
            collection(firestore, 'users'),
            where('chatUsernameNormalized', '==', normalized),
            where('role', 'in', ['dj', 'broadcaster', 'admin']),
          );
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            const userData = snapshot.docs[0].data();
            const djProfile = userData.djProfile || {};
            const info: DJInfo = {
              photoUrl: djProfile.photoUrl || undefined,
              genres: djProfile.genres || undefined,
              description: djProfile.bio || undefined,
            };
            return slotIds.map(id => [id, info] as const);
          }
        } catch { /* ignore - user may not exist */ }
        return [];
      })
    ).then(results => {
      const newCache: DJInfoCache = {};
      for (const pairs of results) {
        for (const [id, info] of pairs) {
          newCache[id] = info;
        }
      }
      if (Object.keys(newCache).length > 0) {
        setDjInfoCache(prev => ({ ...prev, ...newCache }));
      }
    });
  }, [upcomingSlots, djInfoCache]);

  if (upcomingSlots.length === 0) {
    return (
      <div className="text-center py-20 text-gray-500">
        No upcoming scheduled shows.
      </div>
    );
  }

  return (
    <div>
      {groupedByDay.map(([dayLabel, daySlots]) => (
        <div key={dayLabel} className="mb-10">
          <h2 className="text-lg font-bold text-white mb-4 border-b border-gray-800 pb-2">
            {dayLabel}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {daySlots.map(slot => {
              const cardProps = getCardProps(slot, djInfoCache);
              const broadcastLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/broadcast/live?token=${slot.broadcastToken}`;
              const timeStr = new Date(slot.startTime).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              });
              return (
                <div key={slot.id}>
                  <p className="text-xs text-gray-500 mb-1">{timeStr} &middot; {slot.broadcastType}</p>
                  <ShareableShowCardStory {...cardProps} />
                  <CopyLinkButton link={broadcastLink} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
