'use client';

import { useState, useEffect } from 'react';
import { ArchiveSerialized } from '@/types/broadcast';

const MIN_DURATION_SECONDS = 2700; // 45 minutes

interface UseArchivesReturn {
  archives: ArchiveSerialized[];
  featuredArchive: ArchiveSerialized | null;
  loading: boolean;
}

export function useArchives(initial?: ArchiveSerialized[]): UseArchivesReturn {
  const hasSeed = Boolean(initial && initial.length > 0);
  const [archives, setArchives] = useState<ArchiveSerialized[]>(initial ?? []);
  // If we have an initial seed (featured + high, SSR'd), render with it
  // immediately while the full list loads in the background.
  const [loading, setLoading] = useState(!hasSeed);

  useEffect(() => {
    let cancelled = false;
    async function fetchArchives() {
      try {
        // Low network priority so the bulk archive list doesn't compete with
        // the hero image + above-the-fold work. The Featured section + hero
        // already paint from the SSR seed, so the rest can arrive lazily.
        const res = await fetch('/api/archives', { priority: 'low' } as RequestInit);
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        if (cancelled) return;
        const filtered = (data.archives as ArchiveSerialized[]).filter(
          (a) => a.duration >= MIN_DURATION_SECONDS && a.priority !== 'low'
        );
        setArchives(filtered);
      } catch {
        // Keep any initial seed we have rather than clearing it
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // When we already have a seed, defer the full fetch until the browser is
    // idle (after the hero + filters have painted). Without a seed we have
    // nothing to show, so fetch right away.
    if (hasSeed && typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(() => fetchArchives(), { timeout: 2000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }

    fetchArchives();
    return () => { cancelled = true; };
  }, [hasSeed]);

  const featuredArchive = archives.length > 0 ? archives[0] : null;

  return { archives, featuredArchive, loading };
}
