'use client';

import { useState, useEffect } from 'react';
import { ArchiveSerialized } from '@/types/broadcast';

const MIN_DURATION_SECONDS = 2700; // 45 minutes

interface UseArchivesReturn {
  archives: ArchiveSerialized[];
  featuredArchive: ArchiveSerialized | null;
  loading: boolean;
}

export function useArchives(): UseArchivesReturn {
  const [archives, setArchives] = useState<ArchiveSerialized[]>([]);
  const [loading, setLoading] = useState(true);

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
        setArchives([]);
      } finally {
        setLoading(false);
      }
    }
    fetchArchives();
  }, []);

  const featuredArchive = archives.length > 0 ? archives[0] : null;

  return { archives, featuredArchive, loading };
}
