'use client';

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, ReactNode } from 'react';
import { BroadcastStreamContext, BroadcastStreamContextValue } from '@/contexts/BroadcastStreamContext';
import { BPMContext } from '@/contexts/BPMContext';
import { ArchivePlayerProvider } from '@/contexts/ArchivePlayerContext';
import { BroadcastSlotSerialized, ArchiveSerialized } from '@/types/broadcast';

export type DemoMode = 'offline' | 'live' | 'restream';

const DemoModeContext = createContext<{ mode: DemoMode; setMode: (m: DemoMode) => void }>({
  mode: 'offline',
  setMode: () => {},
});

export function useDemoMode() {
  return useContext(DemoModeContext);
}

const DEMO_SHOW_LIVE: BroadcastSlotSerialized = {
  id: 'demo-show',
  stationId: 'channel-main',
  showName: 'IMAGINARY SHOW NAME',
  djName: 'Random DJ Name',
  djUsername: 'randomdjname',
  djUserId: 'demo-user-id',
  djEmail: 'demo@example.com',
  liveDjUsername: 'randomdjname',
  liveDjUserId: 'demo-user-id',
  liveDjPhotoUrl: 'https://image.rinse.fm/_/0079_SEPT_2023_2025-06-17-154928_fccn.jpeg?w=800&h=800',
  showImageUrl: 'https://image.rinse.fm/_/0079_SEPT_2023_2025-06-17-154928_fccn.jpeg?w=800&h=800',
  startTime: Date.now() - 3600000,
  endTime: Date.now() + 3600000,
  broadcastToken: 'demo',
  tokenExpiresAt: Date.now() + 7200000,
  createdAt: Date.now() - 7200000,
  createdBy: 'demo',
  status: 'live',
  broadcastType: 'remote',
  liveDjGenres: ['Deep House', 'Dub Techno', 'Techno'],
  liveDjDescription: 'Skee\'s insight through his daily listening habits, from guilty pleasures to casual recommendations and in between…',
  archiveId: 'demo-archive',
  archiveRecordingUrl: 'https://example.com/demo.mp4',
  archiveDuration: 16997,
  restreamDjs: [
    { name: 'Random DJ Name', email: 'demo@example.com', userId: 'demo-user-id', username: 'randomdjname' },
  ],
};

const DEMO_SHOW_RESTREAM: BroadcastSlotSerialized = {
  ...DEMO_SHOW_LIVE,
  id: 'demo-restream',
  broadcastType: 'restream',
  showName: 'IMAGINARY SHOW NAME',
  restreamDjs: [
    { name: 'Random DJ Name', email: 'demo@example.com', userId: 'demo-user-id', username: 'randomdjname' },
    { name: 'Stacy Christine' },
    { name: 'Lovefingers, Heidi Lawden & Flabbergast' },
  ],
};

// Mock archives for demo (all >45 min)
export const DEMO_ARCHIVES: ArchiveSerialized[] = [
  {
    id: 'demo-archive-1',
    slug: 'sky-rivers-radio-show-04',
    broadcastSlotId: 'slot-1',
    showName: 'Sky Rivers - Radio Show 04',
    djs: [{ name: 'Skee', username: 'skee', email: 'skee@demo.com' }],
    recordingUrl: 'https://example.com/demo-archive-1.mp4',
    duration: 3720, // 62 min
    recordedAt: Date.now() - 86400000, // 1 day ago
    createdAt: Date.now() - 86400000,
    stationId: 'channel-main',
    showImageUrl: 'https://image.rinse.fm/_/0079_SEPT_2023_2025-06-17-154928_fccn.jpeg?w=800&h=800',
  },
  {
    id: 'demo-archive-2',
    slug: 'midnight-mix-03',
    broadcastSlotId: 'slot-2',
    showName: 'Midnight Mix 03',
    djs: [{ name: 'Cron', username: 'cron' }],
    recordingUrl: 'https://example.com/demo-archive-2.mp4',
    duration: 2880, // 48 min
    recordedAt: Date.now() - 172800000, // 2 days ago
    createdAt: Date.now() - 172800000,
    stationId: 'channel-main',
    showImageUrl: 'https://image.rinse.fm/_/0079_SEPT_2023_2025-06-17-154928_fccn.jpeg?w=800&h=800',
  },
  {
    id: 'demo-archive-3',
    slug: 'bass-hour-sessions',
    broadcastSlotId: 'slot-3',
    showName: 'Bass Hour Sessions',
    djs: [{ name: 'Bilalwood', username: 'bilalwood' }],
    recordingUrl: 'https://example.com/demo-archive-3.mp4',
    duration: 3300, // 55 min
    recordedAt: Date.now() - 259200000, // 3 days ago
    createdAt: Date.now() - 259200000,
    stationId: 'channel-main',
  },
  {
    id: 'demo-archive-4',
    slug: 'deep-state-radio',
    broadcastSlotId: 'slot-4',
    showName: 'Deep State Radio',
    djs: [{ name: 'Lovefingers', username: 'lovefingers' }],
    recordingUrl: 'https://example.com/demo-archive-4.mp4',
    duration: 4260, // 71 min
    recordedAt: Date.now() - 345600000, // 4 days ago
    createdAt: Date.now() - 345600000,
    stationId: 'channel-main',
  },
  {
    id: 'demo-archive-5',
    slug: 'ambient-selections-12',
    broadcastSlotId: 'slot-5',
    showName: 'Ambient Selections 12',
    djs: [{ name: 'Stacy Christine' }, { name: 'Heidi Lawden' }],
    recordingUrl: 'https://example.com/demo-archive-5.mp4',
    duration: 3600, // 60 min
    recordedAt: Date.now() - 432000000, // 5 days ago
    createdAt: Date.now() - 432000000,
    stationId: 'channel-main',
  },
];

// Demo genres for the featured archive DJ (Skee)
export const DEMO_DJ_GENRES = ['Ambient', 'Experimental'];
export const DEMO_TIP_LINK = 'https://example.com/tip/skee';

export function DemoBroadcastStreamProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DemoMode>('offline');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heroBarVisible = false;
  const [heroBarObserverReady, setHeroBarObserverReady] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
  }, []);

  const play = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      const audio = audioRef.current;

      // Try HLS stream — works if a broadcast or restream is active
      const hlsUrl = '/api/hls/channel-radio/live.m3u8';

      // Check if native HLS is supported (Safari)
      if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        audio.src = hlsUrl;
        await audio.play();
        setIsPlaying(true);
        setIsLoading(false);
        return;
      }

      // Use HLS.js for other browsers
      const { default: Hls } = await import('hls.js');
      if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(hlsUrl);
        hls.attachMedia(audio);
        hls.on(Hls.Events.MANIFEST_PARSED, async () => {
          try {
            await audio.play();
            setIsPlaying(true);
          } catch {
            setError('No active stream');
          }
          setIsLoading(false);
        });
        hls.on(Hls.Events.ERROR, () => {
          setIsPlaying(false);
          setIsLoading(false);
          setError('No active stream — UI preview only');
        });
        return;
      }

      setIsLoading(false);
      setError('HLS not supported — UI preview only');
    } catch {
      setIsLoading(false);
      setError('No active stream — UI preview only');
    }
  }, []);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const setHeroBarVisibleCb = useCallback(() => {}, []);
  const setHeroBarObserverReadyCb = useCallback((v: boolean) => setHeroBarObserverReady(v), []);

  const isLive = mode !== 'offline';
  const currentShow = mode === 'restream' ? DEMO_SHOW_RESTREAM : DEMO_SHOW_LIVE;
  const djLabel = mode === 'restream'
    ? 'Random DJ Name, Stacy Christine, Lovefingers, Heidi Lawden & Flabbergast'
    : 'Random DJ Name';
  const showLabel = 'IMAGINARY SHOW NAME';

  const value = useMemo<BroadcastStreamContextValue>(() => ({
    isPlaying,
    isLoading,
    isLive,
    isStreaming: isLive,
    currentShow: isLive ? currentShow : null,
    currentDJ: isLive ? djLabel : null,
    error,
    play,
    pause,
    toggle,
    listenerCount: isLive ? 42 : 0,
    audioStream: null,
    showName: isLive ? showLabel : null,
    djName: isLive ? djLabel : null,
    tipLink: null,
    heroBarVisible,
    setHeroBarVisible: setHeroBarVisibleCb,
    heroBarObserverReady,
    setHeroBarObserverReady: setHeroBarObserverReadyCb,
  }), [isPlaying, isLoading, isLive, currentShow, djLabel, showLabel, error, play, pause, toggle, heroBarVisible, setHeroBarVisibleCb, heroBarObserverReady, setHeroBarObserverReadyCb]);

  const modeCtx = useMemo(() => ({ mode, setMode }), [mode]);

  const demoBPM = useMemo(() => ({
    stationBPM: {
      broadcast: { bpm: 128, type: 'bpm' as const, genre: 'House' },
    },
    loading: false,
  }), []);

  return (
    <DemoModeContext.Provider value={modeCtx}>
      <BPMContext.Provider value={demoBPM}>
        <BroadcastStreamContext.Provider value={value}>
          <ArchivePlayerProvider>
            {children}
          </ArchivePlayerProvider>
        </BroadcastStreamContext.Provider>
      </BPMContext.Provider>
    </DemoModeContext.Provider>
  );
}
