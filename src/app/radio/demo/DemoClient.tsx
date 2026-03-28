'use client';

import { useState } from 'react';
import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { LiveBroadcastHero } from '@/components/channel/LiveBroadcastHero';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
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

function OfflineSection() {
  const [notifyEmail, setNotifyEmail] = useState('');
  const [notifyStatus, setNotifyStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  const handleNotifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifyEmail.trim()) return;
    try {
      setNotifyStatus('submitting');
      const res = await fetch('/api/radio-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: notifyEmail.trim(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (!res.ok) throw new Error('Failed to submit');
      setNotifyStatus('success');
      setNotifyEmail('');
    } catch {
      setNotifyStatus('error');
    }
  };

  return (
    <section className="px-4 md:px-8 py-16 md:py-24 text-center relative z-10">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tighter leading-none mb-4">Channel Radio</h1>
        <p className="text-lg md:text-xl text-zinc-300 mb-8">Back online soon.</p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <div className="w-full sm:w-auto">
            {notifyStatus === 'success' ? (
              <p className="text-green-400 text-sm py-3">You&apos;re on the list!</p>
            ) : (
              <form onSubmit={handleNotifySubmit} className="flex">
                <input
                  type="email"
                  placeholder="Get really cool email updates"
                  value={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.value)}
                  required
                  className="bg-white/10 border border-white/20 rounded-l px-4 py-3 text-white placeholder-gray-300 text-sm focus:outline-none focus:border-white/40 min-w-0 flex-1 sm:w-80"
                />
                <button
                  type="submit"
                  disabled={notifyStatus === 'submitting'}
                  className="bg-white/20 border border-white/20 border-l-0 rounded-r px-4 py-3 text-white text-sm font-medium hover:bg-white/30 transition-colors disabled:opacity-50 shrink-0"
                >
                  {notifyStatus === 'submitting' ? '...' : 'Submit'}
                </button>
              </form>
            )}
            {notifyStatus === 'error' && (
              <p className="text-red-400 text-xs mt-1">Something went wrong. Try again.</p>
            )}
          </div>
        </div>
        <p className="text-zinc-500 text-sm mt-6">
          DJs, producers, collectives, reach out to{' '}
          <a href="mailto:djshows@channel-app.com" className="text-white hover:underline">djshows@channel-app.com</a>
          {' '}to host a show or claim your profile
        </p>
      </div>
    </section>
  );
}

function DemoHero() {
  const { isLive, isStreaming } = useBroadcastStreamContext();

  if (isLive && isStreaming) {
    return <LiveBroadcastHero jumpToEarliestShow initialScheduleDate={new Date('2026-04-02')} />;
  }

  return <OfflineSection />;
}

export function DemoClient() {
  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      <div className="sticky top-0 z-[100]">
        <Header currentPage="channel" position="sticky" />
      </div>

      <DemoBroadcastStreamProvider>
        <DemoToggle />
        <DemoHero />
      </DemoBroadcastStreamProvider>
    </div>
  );
}
