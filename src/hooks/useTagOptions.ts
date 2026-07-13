'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { EventDJRef, CollectiveRef } from '@/types/events';

export interface DJOption extends EventDJRef {
  label: string;
}
export interface CollectiveOption extends CollectiveRef {
  label: string;
}

// Shared fetch of DJ / collective tagging options. Mirrors the EventsAdmin
// picker: pending-dj-profiles + dj-role users, and the collectives collection.
// All reads are public per firestore.rules.
//
// Venues are NOT an entity anymore — a venue is free text typed on the event,
// so there is no venue option list to fetch.
export function useTagOptions() {
  const [djs, setDjs] = useState<DJOption[]>([]);
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
        const [pendingSnap, usersSnap, collectivesSnap] = await Promise.all([
          getDocs(collection(db, 'pending-dj-profiles')),
          getDocs(query(collection(db, 'users'), where('role', 'in', ['dj', 'broadcaster', 'admin']))),
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

  return { djs, collectives, loading };
}
