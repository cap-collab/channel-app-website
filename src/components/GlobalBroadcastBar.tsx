'use client';

import { usePathname } from 'next/navigation';
import { useBroadcastLiveStatus } from '@/hooks/useBroadcastLiveStatus';

/**
 * A slim sticky bar shown across all pages when a broadcast is live.
 * Clicking it navigates to /radio and scrolls to the live broadcast hero.
 * Hidden on the /radio page itself (where the full hero is already visible).
 */
export function GlobalBroadcastBar() {
  const { isLive, showName } = useBroadcastLiveStatus();
  const pathname = usePathname();

  // Don't show on /radio — the full hero is already there
  if (!isLive || pathname === '/radio') return null;

  return (
    <a
      href="/radio#live"
      className="fixed top-[52px] left-0 right-0 z-[99] flex items-center justify-center gap-3 bg-black/90 backdrop-blur-md border-b border-white/10 px-4 py-2 hover:bg-white/5 transition-colors cursor-pointer"
    >
      {/* Pulsing red dot */}
      <span className="relative flex h-2 w-2 flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
      </span>
      <span className="text-sm text-white font-medium truncate">
        {showName || 'Live Now'}
      </span>
      <span className="text-[10px] font-mono text-red-500 uppercase tracking-tighter font-bold flex-shrink-0">
        Live
      </span>
      {/* Arrow */}
      <svg className="w-4 h-4 text-zinc-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </a>
  );
}
