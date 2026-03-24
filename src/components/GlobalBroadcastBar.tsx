'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { useBPM } from '@/contexts/BPMContext';

/**
 * A bar shown below the header on all pages when a broadcast is live.
 * Rendered inside the Header component so it's part of the sticky header block.
 * Uses shared BroadcastStreamContext for synced play/pause.
 */
export function GlobalBroadcastBar() {
  const [mounted, setMounted] = useState(false);
  const {
    isLive, isPlaying, isLoading, toggle,
    showName, djName, heroBarVisible,
  } = useBroadcastStreamContext();
  const { stationBPM } = useBPM();
  const broadcastBPM = stationBPM['broadcast']?.bpm ?? null;
  const pathname = usePathname();

  useEffect(() => { setMounted(true); }, []);

  // Return null on first render to match server HTML and avoid hydration mismatch
  if (!mounted) return null;
  // Never show on the go-live broadcast page
  if (pathname === '/broadcast/live') return null;
  if (!isLive) return null;
  // Hide when the LiveBroadcastHero's inline bar is visible (on /radio)
  if (heroBarVisible) return null;

  return (
    <div className="z-[99] bg-black border-b border-white/10 overflow-hidden">
      <div className="flex items-center gap-2 py-2 px-3">
        {/* Play/Pause — synced with broadcast stream */}
        <button
          onClick={toggle}
          className="w-9 h-9 flex items-center justify-center bg-white transition-colors flex-shrink-0"
        >
          {isLoading ? (
            <svg className="w-5 h-5 animate-spin text-black" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : isPlaying ? (
            <svg className="w-5 h-5 text-black" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-black ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Show info — clicking navigates to /radio */}
        <Link href="/radio#live" className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold leading-tight truncate text-white">{showName || 'Live Now'}</h3>
            <span className="relative flex h-2 w-2 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
            </span>
            <span className="text-[10px] font-mono text-red-500 uppercase tracking-tighter font-bold flex-shrink-0">Live</span>
            {broadcastBPM && (
              <span className="text-[10px] font-mono text-red-500 uppercase tracking-tighter flex-shrink-0">
                {broadcastBPM} BPM
              </span>
            )}
          </div>
          {djName && (
            <p className="text-[10px] text-zinc-500 uppercase mt-0.5 truncate">{djName}</p>
          )}
        </Link>

        {/* Love icon */}
        <Link href="/radio#live" className="w-8 h-8 flex items-center justify-center text-accent flex-shrink-0">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        </Link>

        {/* Tip icon */}
        <Link href="/radio#live" className="w-8 h-8 flex items-center justify-center text-green-400 flex-shrink-0">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
