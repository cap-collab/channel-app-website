'use client';

import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { OfflineHero } from '@/components/channel/OfflineHero';

export function DemoClient() {
  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      <div className="sticky top-0 z-[100]">
        <Header currentPage="channel" position="sticky" />
      </div>

      {/* Offline view — no DemoBroadcastStreamProvider needed */}
      <OfflineHero jumpToEarliestShow />
    </div>
  );
}
