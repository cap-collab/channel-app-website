'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { EventDJRef, EventVenueRef, CollectiveRef } from '@/types/events';

export interface DJOption extends EventDJRef {
  label: string;
}
export interface VenueOption extends EventVenueRef {
  label: string;
}
export interface CollectiveOption extends CollectiveRef {
  label: string;
}

// Shared fetch of DJ / venue / collective tagging options. Mirrors the
// EventsAdmin picker: pending-dj-profiles + dj-role users, and the venues +
// collectives collections. All reads are public per firestore.rules.
export function useTagOptions() {
  const [djs, setDjs] = useState<DJOption[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [collectives, setCollectives] = useState<CollectiveOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!db) {
        setLoading(false);
        return;
      }
      try {
        const [pendingSnap, usersSnap, venuesSnap, collectivesSnap] = await Promise.all([
          getDocs(collection(db, 'pending-dj-profiles')),
          getDocs(query(collection(db, 'users'), where('role', 'in', ['dj', 'broadcaster', 'admin']))),
          getDocs(collection(db, 'venues')),
          getDocs(collection(db, 'collectives')),
        ]);

        const djOptions: DJOption[] = [];
        const seen = new Set<string>();

        pendingSnap.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.status !== 'pending') return;
          const username = data.chatUsernameNormalized || '';
          if (username) seen.add(username);
          const name = data.chatUsername || data.chatUsernameNormalized || 'Unknown';
          djOptions.push({
            label: name,
            djName: name,
            djUsername: data.chatUsernameNormalized || undefined,
            djPhotoUrl: data.djProfile?.photoUrl || undefined,
          });
        });

        usersSnap.forEach((docSnap) => {
          const data = docSnap.data();
          const username = data.chatUsernameNormalized || '';
          if (username && seen.has(username)) return;
          const name = data.chatUsername || data.displayName || 'Unknown';
          djOptions.push({
            label: name,
            djName: name,
            djUserId: docSnap.id,
            djUsername: data.chatUsernameNormalized || data.chatUsername || undefined,
            djPhotoUrl: data.djProfile?.photoUrl || undefined,
          });
        });

        djOptions.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));

        const venueOptions: VenueOption[] = [];
        venuesSnap.forEach((docSnap) => {
          const data = docSnap.data();
          if (!data.name) return;
          venueOptions.push({ label: data.name, venueId: docSnap.id, venueName: data.name });
        });
        venueOptions.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));

        const collectiveOptions: CollectiveOption[] = [];
        collectivesSnap.forEach((docSnap) => {
          const data = docSnap.data();
          if (!data.name) return;
          collectiveOptions.push({
            label: data.name,
            collectiveId: docSnap.id,
            collectiveName: data.name,
            collectiveSlug: data.slug || undefined,
            collectivePhoto: data.photo || null,
          });
        });
        collectiveOptions.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));

        if (!cancelled) {
          setDjs(djOptions);
          setVenues(venueOptions);
          setCollectives(collectiveOptions);
          setLoading(false);
        }
      } catch (err) {
        console.error('[useTagOptions] fetch failed', err);
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { djs, venues, collectives, loading };
}
