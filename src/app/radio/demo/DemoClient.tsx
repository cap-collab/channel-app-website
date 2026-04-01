'use client';

import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { LiveBroadcastHero } from '@/components/channel/LiveBroadcastHero';
import { ArchiveHero } from '@/components/channel/ArchiveHero';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { DemoBroadcastStreamProvider, useDemoMode, DemoMode, DEMO_ARCHIVES, DEMO_DJ_GENRES, DEMO_TIP_LINK } from './DemoBroadcastStreamProvider';

const MODES: { value: DemoMode; label: string }[] = [
  { value: 'offline', label: 'Offline' },
  { value: 'live', label: 'Live' },
  { value: 'restream', label: 'Restream' },
];

function DemoToggle() {
  const { mode, setMode } = useDemoMode();

  return (
    <div className="relative z-50 flex justify-center py-3">
      <div className="inline-flex bg-white/10 border border-white/20 rounded-full p-0.5">
        {MODES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-colors ${
              mode === value
                ? 'bg-white text-black'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DemoHero() {
  const { isLive, isStreaming } = useBroadcastStreamContext();

  if (isLive && isStreaming) {
    return <LiveBroadcastHero jumpToEarliestShow initialScheduleDate={new Date('2026-04-02')} />;
  }

  return (
    <ArchiveHero
      archives={DEMO_ARCHIVES}
      featuredArchive={DEMO_ARCHIVES[0]}
      demoGenres={DEMO_DJ_GENRES}
      demoTipLink={DEMO_TIP_LINK}
    />
  );
}

export function DemoClient() {
  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      <div className="sticky top-0 z-[100]">
        <Header currentPage="channel" position="sticky" />
      </div>

      <DemoBroadcastStreamProvider>
        <DemoHero />
        <DemoToggle />
      </DemoBroadcastStreamProvider>
    </div>
  );
}
