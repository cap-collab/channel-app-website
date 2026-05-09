'use client';

import { ChannelClient } from '@/app/radio/ChannelClient';
import { DemoBroadcastStreamProvider, useDemoMode, DemoMode } from './DemoBroadcastStreamProvider';

const MODES: { value: DemoMode; label: string }[] = [
  { value: 'offline', label: 'Offline' },
  { value: 'live', label: 'Live' },
  { value: 'restream', label: 'Restream' },
];

function DemoToggle() {
  const { mode, setMode } = useDemoMode();

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[110]">
      <div className="inline-flex bg-black/80 backdrop-blur border border-white/20 rounded-full p-0.5 shadow-lg">
        {MODES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-colors ${
              mode === value ? 'bg-white text-black' : 'text-zinc-300 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DemoClient() {
  return (
    <DemoBroadcastStreamProvider>
      <ChannelClient hidePastShows />
      <DemoToggle />
    </DemoBroadcastStreamProvider>
  );
}
