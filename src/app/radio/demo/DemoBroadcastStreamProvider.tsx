'use client';

import { useState, useCallback, useMemo, useRef, useEffect, ReactNode } from 'react';
import { BroadcastStreamContext, BroadcastStreamContextValue } from '@/contexts/BroadcastStreamContext';
import { BroadcastSlotSerialized } from '@/types/broadcast';

const DEMO_SHOW: BroadcastSlotSerialized = {
  id: 'demo-show',
  stationId: 'channel-main',
  showName: 'Late Night Sessions',
  djName: 'Avalon Emerson',
  djUsername: 'avalonemerson',
  djUserId: 'demo-user-id',
  djEmail: 'demo@channel.fm',
  liveDjUsername: 'avalonemerson',
  liveDjUserId: 'demo-user-id',
  liveDjPhotoUrl: 'https://nowadays.nyc/wp-content/uploads/2023/11/Avalon-1500x1500.jpg',
  showImageUrl: 'https://nowadays.nyc/wp-content/uploads/2023/11/Avalon-1500x1500.jpg',
  startTime: Date.now() - 3600000,
  endTime: Date.now() + 3600000,
  broadcastToken: 'demo',
  tokenExpiresAt: Date.now() + 7200000,
  createdAt: Date.now() - 7200000,
  createdBy: 'demo',
  status: 'live',
  broadcastType: 'remote',
  liveDjPromoText: 'Deep house & techno vibes every Friday night. Tune in and feel the groove.',
  liveDjGenres: ['Deep House', 'Techno'],
  liveDjDescription: 'Patrick Shiroishi is a Japanese-American multi-instrumentalist and composer based in Los Angeles who is perhaps best known for his extensive and incredibly intense work with the saxophone. Over the last decade',
};

export function DemoBroadcastStreamProvider({ children }: { children: ReactNode }) {
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

  const value = useMemo<BroadcastStreamContextValue>(() => ({
    isPlaying,
    isLoading,
    isLive: true,
    currentShow: DEMO_SHOW,
    currentDJ: 'Avalon Emerson',
    error,
    play,
    pause,
    toggle,
    listenerCount: 42,
    audioStream: null,
    showName: 'Late Night Sessions',
    djName: 'Avalon Emerson',
    tipEligible: true,
    heroBarVisible,
    setHeroBarVisible: setHeroBarVisibleCb,
  }), [isPlaying, isLoading, error, play, pause, toggle, heroBarVisible, setHeroBarVisibleCb]);

  return (
    <BroadcastStreamContext.Provider value={value}>
      {children}
    </BroadcastStreamContext.Provider>
  );
}
