'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { BroadcastSlotSerialized } from '@/types/broadcast';
import { ShareableShowCardStory } from '@/components/studio/ShareableShowCardStory';
import { extractInstagramHandle } from '@/lib/genres';

interface MarketingTabProps {
  slots: BroadcastSlotSerialized[];
}

// Resolved DJ info from email lookup
interface DJInfo {
  photoUrl?: string;
  genres?: string[];
  description?: string;
  instagram?: string; // raw value from profile (URL or handle)
  // metaOptIn=false means the DJ opted out of having their show image used
  // for Instagram/Meta marketing. Marketing tab hides the image and shows
  // a notice instead. Absence of the field = opted in (default).
  metaOptIn?: boolean;
}

type DJInfoCache = Record<string, DJInfo>;
// Per-slot IG lookups, keyed by slot id then by normalized DJ name — handles venue b2b
type SlotInstagramCache = Record<string, Record<string, string>>;

function normalizeName(name: string): string {
  return name.replace(/[\s-]+/g, '').toLowerCase();
}

// Returns [{ djName, handle }] for each DJ in the slot, preferring slot-level djSocialLinks.
function getInstagramHandles(
  slot: BroadcastSlotSerialized,
  slotIgCache: SlotInstagramCache,
  djInfoCache: DJInfoCache,
): Array<{ djName: string; handle: string }> {
  const perSlot = slotIgCache[slot.id] || {};
  const result: Array<{ djName: string; handle: string }> = [];
  const push = (djName: string, raw: string | undefined) => {
    if (!djName) return;
    const handle = raw ? extractInstagramHandle(raw) : '';
    if (handle) result.push({ djName, handle });
  };

  if (slot.broadcastType === 'venue' && slot.djSlots?.length) {
    for (const ds of slot.djSlots) {
      const djName = ds.djName || '';
      const slotLevel = ds.djSocialLinks?.instagram;
      if (slotLevel) {
        push(djName, slotLevel);
      } else {
        const looked = djName ? perSlot[normalizeName(djName)] : undefined;
        push(djName, looked);
      }
    }
  } else {
    const djName = slot.djName || '';
    const looked = djName ? perSlot[normalizeName(djName)] : undefined;
    push(djName, looked || djInfoCache[slot.id]?.instagram);
  }
  return result;
}

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

function InstagramHandles({ handles }: { handles: Array<{ djName: string; handle: string }> }) {
  const [copied, setCopied] = useState(false);
  if (handles.length === 0) return null;

  const tagString = handles.map(h => `@${h.handle}`).join(' ');
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(tagString);
    } catch {
      const input = document.createElement('input');
      input.value = tagString;
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
      className="w-full flex items-center justify-center gap-2 bg-gray-800 text-gray-300 hover:bg-gray-700 font-medium py-2 rounded text-xs transition-colors mt-2"
      title={handles.map(h => `${h.djName}: @${h.handle}`).join('\n')}
    >
      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
      </svg>
      {copied ? 'Copied!' : `Copy IG tags (${handles.length})`}
    </button>
  );
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
  const [slotIgCache, setSlotIgCache] = useState<SlotInstagramCache>({});

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
              instagram: djProfile.socialLinks?.instagram || undefined,
              metaOptIn: djProfile.metaOptIn === false ? false : true,
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

  // Per-DJ IG lookup for venue shows where djSlots[].djSocialLinks.instagram may be missing.
  useEffect(() => {
    if (!db) return;
    const firestore = db;

    // Map: slotId -> { normalizedName -> djName } for DJs missing slot-level IG.
    const needed: Record<string, Record<string, string>> = {};
    const normalizedNames = new Set<string>();
    for (const s of upcomingSlots) {
      if (s.broadcastType !== 'venue' || !s.djSlots?.length) continue;
      for (const ds of s.djSlots) {
        if (!ds.djName) continue;
        if (ds.djSocialLinks?.instagram) continue; // have it from the slot
        const normalized = normalizeName(ds.djName);
        if (slotIgCache[s.id]?.[normalized] !== undefined) continue; // already resolved
        if (!needed[s.id]) needed[s.id] = {};
        needed[s.id][normalized] = ds.djName;
        normalizedNames.add(normalized);
      }
    }
    if (normalizedNames.size === 0) return;

    (async () => {
      const resolved: Record<string, string> = {};
      await Promise.all(
        Array.from(normalizedNames).map(async (normalized) => {
          try {
            const q = query(
              collection(firestore, 'users'),
              where('chatUsernameNormalized', '==', normalized),
              where('role', 'in', ['dj', 'broadcaster', 'admin']),
            );
            const snap = await getDocs(q);
            if (!snap.empty) {
              const ig = snap.docs[0].data()?.djProfile?.socialLinks?.instagram;
              if (ig) resolved[normalized] = ig;
            }
          } catch { /* ignore */ }
        }),
      );
      setSlotIgCache(prev => {
        const next: SlotInstagramCache = { ...prev };
        for (const [slotId, names] of Object.entries(needed)) {
          const existing = next[slotId] ? { ...next[slotId] } : {};
          for (const normalized of Object.keys(names)) {
            // Store even empty string to avoid refetching
            existing[normalized] = resolved[normalized] || '';
          }
          next[slotId] = existing;
        }
        return next;
      });
    })();
  }, [upcomingSlots, slotIgCache]);

  if (upcomingSlots.length === 0) {
    return (
      <div className="text-center py-20 text-gray-500">
        No upcoming scheduled shows.
      </div>
    );
  }

  return (
    <div>
      {groupedByDay.map(([dayLabel, daySlots]) => {
        // List DJs in this day's slots who opted out of Instagram/Meta
        // sharing. Surface a heads-up at the top of the day so admin
        // doesn't accidentally use one of those shows in a daily roundup
        // composed elsewhere.
        const optedOutDjs = daySlots
          .filter((s) => djInfoCache[s.id]?.metaOptIn === false)
          .map((s) => s.djName)
          .filter((n): n is string => !!n);

        return (
        <div key={dayLabel} className="mb-10">
          <h2 className="text-lg font-bold text-white mb-4 border-b border-gray-800 pb-2">
            {dayLabel}
          </h2>
          {optedOutDjs.length > 0 && (
            <p className="text-xs text-yellow-400/80 mb-4">
              Opted out of Meta sharing: {optedOutDjs.join(', ')}
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {daySlots.map(slot => {
              const cardProps = getCardProps(slot, djInfoCache);
              const broadcastLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/broadcast/live?token=${slot.broadcastToken}`;
              const timeStr = new Date(slot.startTime).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              });
              const isRestream = slot.broadcastType === 'restream';
              const igHandles = isRestream ? [] : getInstagramHandles(slot, slotIgCache, djInfoCache);
              const djOptedOut = djInfoCache[slot.id]?.metaOptIn === false;
              return (
                <div key={slot.id}>
                  <p className="text-xs text-gray-500 mb-1">{timeStr} &middot; {slot.broadcastType}</p>
                  {isRestream ? (
                    <p className="text-xs text-gray-600 italic py-3">
                      {slot.showName || 'Restream'} — no marketing assets for restreams
                    </p>
                  ) : djOptedOut ? (
                    <p className="text-xs text-yellow-400/80 italic py-3">
                      {slot.showName || cardProps.djName} — DJ opted out of Meta sharing,
                      no show image rendered
                    </p>
                  ) : (
                    <>
                      <ShareableShowCardStory {...cardProps} />
                      <CopyLinkButton link={broadcastLink} />
                      {igHandles.length > 0 && (
                        <div className="mt-2 text-xs text-gray-400 space-y-0.5">
                          {igHandles.map(h => (
                            <div key={h.djName} className="flex justify-between gap-2">
                              <span className="text-gray-500 truncate">{h.djName}</span>
                              <a
                                href={`https://instagram.com/${h.handle}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-gray-300 hover:text-white font-mono"
                              >
                                @{h.handle}
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                      <InstagramHandles handles={igHandles} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        );
      })}
    </div>
  );
}
