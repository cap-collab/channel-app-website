'use client';

import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { LiveBroadcastHero } from '@/components/channel/LiveBroadcastHero';
import { CalendarGrid } from '@/components/calendar/CalendarGrid';
import { DemoBroadcastStreamProvider } from './DemoBroadcastStreamProvider';

export function DemoClient() {
  return (
    <DemoBroadcastStreamProvider>
      <div className="min-h-[100dvh] text-white relative flex flex-col">
        <AnimatedBackground />
        <div className="sticky top-0 z-[100]">
          <Header currentPage="channel" position="sticky" />
        </div>

        {/* Live Broadcast Hero — always rendered as if live */}
        <LiveBroadcastHero />

        {/* Calendar */}
        <section className="px-4 md:px-8 py-8 relative z-10">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">Schedule</h2>
            <CalendarGrid />
          </div>
        </section>
      </div>
    </DemoBroadcastStreamProvider>
  );
}
