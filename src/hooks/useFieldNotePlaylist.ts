'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { registerAudio, pauseOthers } from '@/lib/audio-exclusive';
import { FieldNoteSerialized } from '@/types/field-notes';

// Lightweight sequential player for a queue of field notes (newest-first). A
// single <audio> advances on 'ended'. Registers with audio-exclusive so it and
// the live/archive/radio players stay mutually exclusive — this never touches
// the live/archive audio pipelines.
export function useFieldNotePlaylist() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<FieldNoteSerialized[]>([]);
  const indexRef = useRef(0);
  const playlistKeyRef = useRef<string | null>(null);

  const [activePlaylistKey, setActivePlaylistKey] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = 'none';
      audio.addEventListener('play', () => setIsPlaying(true));
      audio.addEventListener('pause', () => setIsPlaying(false));
      audio.addEventListener('ended', () => {
        const next = indexRef.current + 1;
        if (next < queueRef.current.length) {
          indexRef.current = next;
          const note = queueRef.current[next];
          setCurrentId(note.id);
          audio.src = note.audioUrl;
          pauseOthers('fieldnotes');
          audio.play().catch(() => setIsPlaying(false));
        } else {
          setIsPlaying(false);
          setCurrentId(null);
          setActivePlaylistKey(null);
          playlistKeyRef.current = null;
        }
      });
      audioRef.current = audio;
      registerAudio('fieldnotes', audio);
    }
    return audioRef.current;
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        registerAudio('fieldnotes', null);
        audioRef.current = null;
      }
    };
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  // Play (or toggle) a playlist keyed by `key`, from its first (newest) note.
  const playPlaylist = useCallback((key: string, notes: FieldNoteSerialized[]) => {
    const audio = getAudio();

    // Toggle pause/resume when the same playlist is active.
    if (playlistKeyRef.current === key) {
      if (audio.paused) {
        pauseOthers('fieldnotes');
        audio.play().catch(() => setIsPlaying(false));
      } else {
        audio.pause();
      }
      return;
    }

    if (notes.length === 0) return;
    queueRef.current = notes;
    indexRef.current = 0;
    playlistKeyRef.current = key;
    setActivePlaylistKey(key);
    const first = notes[0];
    setCurrentId(first.id);
    audio.src = first.audioUrl;
    audio.currentTime = 0;
    pauseOthers('fieldnotes');
    audio.play().catch(() => setIsPlaying(false));
  }, [getAudio]);

  return { playPlaylist, pause, isPlaying, currentId, activePlaylistKey };
}
