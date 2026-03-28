'use client';

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, ReactNode } from 'react';
import { BroadcastStreamContext, BroadcastStreamContextValue } from '@/contexts/BroadcastStreamContext';
import { BroadcastSlotSerialized } from '@/types/broadcast';

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
  djName: 'Skee Mask',
  djUsername: 'skeemask',
  djUserId: 'demo-user-id',
  djEmail: 'demo@example.com',
  liveDjUsername: 'skeemask',
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
  liveDjPromoText: 'Skee\'s insight through his daily listening habits, from guilty pleasures to casual recommendations and in between…',
  liveDjGenres: ['Deep House', 'Dub Techno', 'Techno'],
  liveDjDescription: 'Skee\'s insight through his daily listening habits, from guilty pleasures to casual recommendations and in between…',
  archiveId: 'demo-archive',
  archiveRecordingUrl: 'https://example.com/demo.mp4',
  archiveDuration: 16997,
  restreamDjs: [
    { name: 'Skee Mask', email: 'demo@example.com', userId: 'demo-user-id', username: 'skeemask' },
  ],
};

const DEMO_SHOW_RESTREAM: BroadcastSlotSerialized = {
  ...DEMO_SHOW_LIVE,
  id: 'demo-restream',
  broadcastType: 'restream',
  showName: 'IMAGINARY SHOW NAME (Restream)',
  restreamDjs: [
    { name: 'Skee Mask', email: 'demo@example.com', userId: 'demo-user-id', username: 'skeemask' },
    { name: 'Stacy Christine' },
    { name: 'Lovefingers, Heidi Lawden & Flabbergast' },
  ],
};

export function DemoBroadcastStreamProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DemoMode>('offline');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heroBarVisible, setHeroBarVisible] = useState(true);
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

  const setHeroBarVisibleCb = useCallback((v: boolean) => setHeroBarVisible(v), []);

  const isLive = mode !== 'offline';
  const currentShow = mode === 'restream' ? DEMO_SHOW_RESTREAM : DEMO_SHOW_LIVE;
  const djLabel = mode === 'restream'
    ? 'Skee Mask, Stacy Christine, Lovefingers, Heidi Lawden & Flabbergast'
    : 'Skee Mask';
  const showLabel = mode === 'restream' ? 'IMAGINARY SHOW NAME (Restream)' : 'IMAGINARY SHOW NAME';

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
    tipEligible: isLive,
    heroBarVisible,
    setHeroBarVisible: setHeroBarVisibleCb,
  }), [isPlaying, isLoading, isLive, currentShow, djLabel, showLabel, error, play, pause, toggle, heroBarVisible, setHeroBarVisibleCb]);

  const modeCtx = useMemo(() => ({ mode, setMode }), [mode]);

  return (
    <DemoModeContext.Provider value={modeCtx}>
      <BroadcastStreamContext.Provider value={value}>
        {children}
      </BroadcastStreamContext.Provider>
    </DemoModeContext.Provider>
  );
}
