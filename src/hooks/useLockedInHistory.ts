'use client';

import { useEffect, useState } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';

export interface LockedInDj {
  djUsername: string;
  lastAt: string; // ISO timestamp
}

// Fetches the list of DJs the current user has "locked in" with in the past
// (15+ min cumulative listening, recorded via a chat message in
// chats/{djUsername}/messages with messageType=lockedin). Backed by the
// server-side /api/users/me/locked-in-djs endpoint because the underlying
// collection-group query isn't easily expressible from the client SDK with
// our existing security rules.
export function useLockedInHistory() {
  const { user } = useAuthContext();
  const [djs, setDjs] = useState<LockedInDj[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setDjs([]);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/users/me/locked-in-djs', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (!cancelled) {
            setDjs([]);
            setLoading(false);
          }
          return;
        }
        const data = (await res.json()) as { djs?: LockedInDj[] };
        if (!cancelled) {
          setDjs(Array.isArray(data.djs) ? data.djs : []);
          setLoading(false);
        }
      } catch (err) {
        console.error('[useLockedInHistory] fetch failed', err);
        if (!cancelled) {
          setDjs([]);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { lockedInDjs: djs, loading };
}
