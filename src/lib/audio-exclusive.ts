// Tracks which audio element is currently "owning" playback so a new player
// can pause the other one. Live and archive share this registry — whichever
// starts last wins. No events, no listeners, no re-renders.

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
