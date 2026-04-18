'use client';

import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { LiveBroadcastHero } from '@/components/channel/LiveBroadcastHero';
import { ArchiveHero } from '@/components/channel/ArchiveHero';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { useArchives } from '@/hooks/useArchives';
import { DemoBroadcastStreamProvider, useDemoMode, DemoMode } from './DemoBroadcastStreamProvider';

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
  const { archives, featuredArchive, loading } = useArchives();

  if (isLive && isStreaming) {
    return <LiveBroadcastHero jumpToEarliestShow initialScheduleDate={new Date('2026-04-02')} />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <svg className="animate-spin h-8 w-8 text-zinc-500" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    );
  }

  if (!featuredArchive) {
    return (
      <div className="text-center py-24 text-zinc-500">
        <p>No archives available yet.</p>
      </div>
    );
  }

  return (
    <ArchiveHero
      archives={archives}
      featuredArchive={featuredArchive}
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
