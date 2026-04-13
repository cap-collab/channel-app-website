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
  const [archives, setArchives] = useState<ArchiveSerialized[]>(initial ?? []);
  // If we have an initial seed, render with it immediately while the full list loads
  const [loading, setLoading] = useState(!initial || initial.length === 0);

  useEffect(() => {
    async function fetchArchives() {
      try {
        const res = await fetch('/api/archives');
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        const filtered = (data.archives as ArchiveSerialized[]).filter(
          (a) => a.duration >= MIN_DURATION_SECONDS
        );
        setArchives(filtered);
      } catch {
        // Keep any initial seed we have rather than clearing it
      } finally {
        setLoading(false);
      }
    }
    fetchArchives();
  }, []);

  const featuredArchive = archives.length > 0 ? archives[0] : null;

  return { archives, featuredArchive, loading };
}
