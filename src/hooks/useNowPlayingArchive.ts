'use client';

import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import { useArchiveRadioContext } from '@/contexts/ArchiveRadioContext';
import type { ArchiveSerialized } from '@/types/broadcast';
import { normalizeUsername } from '@/lib/dj-matching';

export interface NowPlayingArchive {
  // The archive the listener is ACTIVELY hearing (archive player or radio
  // loop), or null. Never the homepage "featured" pick — only what's playing,
  // so callers (e.g. the tracklist reply) can't name the wrong show.
  archive: ArchiveSerialized | null;
  // A live broadcast (or restream) is on air and playing for this listener.
  // When true there is no archive tracklist to surface.
  isLive: boolean;
  // The normalized DJ chat room for the playing archive (djs[0].username),
  // or '' when there's no archive. Matches the room mapping used for archive
  // chat writes elsewhere.
  djRoom: string;
}

/**
 * Single source of truth for "what archive is the listener currently hearing".
 * Reads the three global playback contexts (all mounted app-wide in
 * Providers.tsx) with the same precedence the chat write-routing uses, but
 * resolves ONLY the actively-playing source — never a featured/hero fallback.
 */
export function useNowPlayingArchive(): NowPlayingArchive {
  const { isLive, isStreaming, isPlaying } = useBroadcastStreamContext();
  const archivePlayer = useArchivePlayer();
  const radioCtx = useArchiveRadioContext();

  const isLivePlaying = isLive && isStreaming && isPlaying;
  const isArchivePlaying = archivePlayer.isPlaying || archivePlayer.isLoading;
  const isRadioPlaying = !!radioCtx?.isPlaying || !!radioCtx?.isLoading;

  let archive: ArchiveSerialized | null = null;
  if (isLivePlaying) {
    archive = null; // live on air → no archive
  } else if (isArchivePlaying) {
    archive = archivePlayer.currentArchive;
  } else if (isRadioPlaying) {
    archive = radioCtx?.currentArchive ?? null;
  } else {
    // Nothing actively playing: fall back to whichever archive source is
    // primed (radio is the page default), still never the featured hero.
    archive = archivePlayer.currentArchive || radioCtx?.currentArchive || null;
  }

  // Chat room = canonical normalizeUsername of the DJ (matches the room keyed by
  // chatUsernameNormalized in useDJProfileChat), so tracklist/system messages land
  // in the right room even for dotted names.
  const djRoom = archive?.djs?.[0]?.username ? normalizeUsername(archive.djs[0].username) : '';

  return { archive, isLive: isLivePlaying, djRoom };
}
