'use client';

import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { LiveBroadcastHero } from '@/components/channel/LiveBroadcastHero';
import { DemoBroadcastStreamProvider } from './DemoBroadcastStreamProvider';

export function DemoClient() {
  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      <div className="sticky top-0 z-[100]">
        <Header currentPage="channel" position="sticky" />
      </div>

      {/* Online view — wrapped in DemoBroadcastStreamProvider for mock live data */}
      <DemoBroadcastStreamProvider>
        <LiveBroadcastHero jumpToEarliestShow initialScheduleDate={new Date('2026-04-02')} />
      </DemoBroadcastStreamProvider>
    </div>
  );
}
