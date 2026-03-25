'use client';

import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { LiveBroadcastHero } from '@/components/channel/LiveBroadcastHero';
import { DemoBroadcastStreamProvider } from './DemoBroadcastStreamProvider';

export function DemoClient() {
  return (
    <DemoBroadcastStreamProvider>
      <div className="min-h-[100dvh] text-white relative flex flex-col">
        <AnimatedBackground />
        <div className="sticky top-0 z-[100]">
          <Header currentPage="channel" position="sticky" />
        </div>

        {/* Live Broadcast Hero — includes player, chat, and Channel Radio schedule tab */}
        <LiveBroadcastHero jumpToEarliestShow />
      </div>
    </DemoBroadcastStreamProvider>
  );
}
