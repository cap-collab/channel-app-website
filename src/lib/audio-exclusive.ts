// Tracks which audio element is currently "owning" playback so a new player
// can pause the other one. Live and archive share this registry — whichever
// starts last wins. No events, no listeners, no re-renders.
//
// Radio↔live and radio↔archive coordination is NOT handled here — instead
// it's done via explicit React-state .pause() calls in ArchiveRadioContext
// (mirroring how archive↔live coordinates via pauseBroadcast() calls in
// ArchivePlayerContext). That keeps the React state in sync, which the
// inline + sticky players read for play/pause icons and barMode selection.

type Source = 'live' | 'archive';

const elements: Partial<Record<Source, HTMLAudioElement>> = {};

export function registerAudio(source: Source, el: HTMLAudioElement | null): void {
  if (el) elements[source] = el;
  else delete elements[source];
}

export function pauseOthers(source: Source): void {
  for (const key of Object.keys(elements) as Source[]) {
    if (key === source) continue;
    const el = elements[key];
    if (el && !el.paused) el.pause();
  }
}

/**
 * Pause a specific registered source's audio element. Used when we need
 * to silence a stale source from outside its own hook (e.g. live audio
 * lingering during useBroadcastStream's internal 60s grace after the
 * live actually ended with no follow-up — ArchiveRadioContext's Rule B
 * calls this to stop the stale live audio at the moment of auto-handoff
 * to radio).
 */
export function pauseSource(source: Source): void {
  const el = elements[source];
  if (el && !el.paused) el.pause();
}
