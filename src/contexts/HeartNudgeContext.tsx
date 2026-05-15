'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBroadcastStreamContext } from './BroadcastStreamContext';
import { useArchivePlayer } from './ArchivePlayerContext';
import { useArchiveRadioContext } from './ArchiveRadioContext';

type HeartNudgeContextValue = {
  nudgeKey: number;
  nudge: () => void;
};

const HeartNudgeContext = createContext<HeartNudgeContextValue>({ nudgeKey: 0, nudge: () => {} });

export function HeartNudgeProvider({ children }: { children: ReactNode }) {
  const [nudgeKey, setNudgeKey] = useState(0);
  const nudge = useCallback(() => setNudgeKey((k) => k + 1), []);

  const broadcast = useBroadcastStreamContext();
  const archivePlayer = useArchivePlayer();
  const radio = useArchiveRadioContext();

  const broadcastPlaying = broadcast.isPlaying;
  const archivePlaying = archivePlayer.isPlaying;
  const radioPlaying = !!radio?.isPlaying;
  const anyPlaying = broadcastPlaying || archivePlaying || radioPlaying;

  // Rising-edge bump: any player transitions from not-playing to playing.
  // The 5-min listen milestone is already wired separately via
  // onListenMilestoneRef → nudge() in GlobalBroadcastBar.
  const prevAnyPlayingRef = useRef(anyPlaying);
  useEffect(() => {
    if (!prevAnyPlayingRef.current && anyPlaying) nudge();
    prevAnyPlayingRef.current = anyPlaying;
  }, [anyPlaying, nudge]);

  // Return-to-screen: re-bump every time the user comes back and audio is
  // playing. Covers tab switching / minimize / lock-screen (visibilitychange)
  // and same-desktop window switching (focus).
  const anyPlayingRef = useRef(anyPlaying);
  useEffect(() => { anyPlayingRef.current = anyPlaying; }, [anyPlaying]);
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === 'visible' && anyPlayingRef.current) nudge();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [nudge]);

  const value = useMemo(() => ({ nudgeKey, nudge }), [nudgeKey, nudge]);

  return <HeartNudgeContext.Provider value={value}>{children}</HeartNudgeContext.Provider>;
}

export function useHeartNudge() {
  return useContext(HeartNudgeContext);
}
