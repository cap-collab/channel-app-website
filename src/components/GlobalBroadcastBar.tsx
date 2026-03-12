'use client';

import { usePathname } from 'next/navigation';
import { useBroadcastLiveStatus } from '@/hooks/useBroadcastLiveStatus';

/**
 * A fixed bar shown across all pages (except /radio) when a broadcast is live.
 * Matches the same design as the player bar on /radio.
 * Clicking it navigates to /radio and scrolls to the live broadcast hero.
 */
export function GlobalBroadcastBar() {
  const { isLive, showName, djName } = useBroadcastLiveStatus();
  const pathname = usePathname();

  // Don't show on /radio — the hero has its own fixed bar
  if (!isLive || pathname === '/radio') return null;

  return (
    <a
      href="/radio#live"
      className="fixed top-[52px] left-0 right-0 z-[99] flex items-center gap-3 bg-black border-b border-white/10 px-4 py-2 hover:bg-white/5 transition-colors cursor-pointer"
    >
      {/* Play icon */}
      <div className="w-10 h-10 flex items-center justify-center bg-white flex-shrink-0">
        <svg className="w-5 h-5 text-black ml-0.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>

      {/* Show info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold leading-tight truncate text-white">{showName || 'Live Now'}</h3>
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
          </span>
          <span className="text-[10px] font-mono text-red-500 uppercase tracking-tighter font-bold flex-shrink-0">Live</span>
        </div>
        {djName && (
          <p className="text-[10px] text-zinc-500 uppercase mt-0.5">{djName}</p>
        )}
      </div>

      {/* Love icon */}
      <div className="w-10 h-10 flex items-center justify-center bg-white/10 text-accent flex-shrink-0">
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      </div>

      {/* Tip icon */}
      <div className="w-10 h-10 flex items-center justify-center bg-white/10 text-green-400 flex-shrink-0">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
        </svg>
      </div>
    </a>
  );
}
