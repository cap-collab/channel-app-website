'use client';

import { ChannelClient } from '@/app/radio/ChannelClient';
import type { ArchiveSerialized } from '@/types/broadcast';

// /radio/demo: kept around as an alternative entry point during the
// migration. Identical to /radio now — both render ChannelClient. The
// ArchiveRadioProvider lives at the app root so radio audio follows the
// listener across pages (matching live broadcast behavior).
export function DemoClient({
  initialHeroArchives,
  initialPreferredHero,
}: {
  initialHeroArchives?: ArchiveSerialized[];
  initialPreferredHero?: { spiral: ArchiveSerialized | null; star: ArchiveSerialized | null };
} = {}) {
  return (
    <ChannelClient
      initialHeroArchives={initialHeroArchives}
      initialPreferredHero={initialPreferredHero}
    />
  );
}
