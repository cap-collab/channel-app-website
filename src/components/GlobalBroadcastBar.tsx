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

      {/* Tip icon — same $ circle as TipButton */}
      <div className="w-10 h-10 flex items-center justify-center bg-white/10 text-green-400 flex-shrink-0">
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z" />
        </svg>
      </div>
    </a>
  );
}
