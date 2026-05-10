'use client';

import { ChannelClient } from '@/app/radio/ChannelClient';
import { ArchiveRadioProvider } from '@/contexts/ArchiveRadioContext';
import type { ArchiveSerialized } from '@/types/broadcast';

// /radio/demo: same data + providers as /radio, plus the ArchiveRadioProvider
// so the new continuous-archive radio is mounted. Live state, archives, BPM,
// etc. all come from the app-level providers — /demo reflects production
// reality so the auto-switch-to-live behaviour fires the same as /radio.
export function DemoClient({
  initialHeroArchives,
  initialPreferredHero,
}: {
  initialHeroArchives?: ArchiveSerialized[];
  initialPreferredHero?: { spiral: ArchiveSerialized | null; star: ArchiveSerialized | null };
} = {}) {
  return (
    <ArchiveRadioProvider enabled>
      <ChannelClient
        demoMode
        hidePastShows
        initialHeroArchives={initialHeroArchives}
        initialPreferredHero={initialPreferredHero}
      />
    </ArchiveRadioProvider>
  );
}
