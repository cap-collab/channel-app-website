// iOS WebKit (Safari + Chrome iOS) kills detached <audio> elements on
// scroll, transitions, and visibility changes — the UI keeps reporting
// playback but no sound reaches the speakers, and pause/play can't
// recover. Keeping the element in the DOM preserves the audio session.
//
// Use createHostedAudio() for new elements, attachToAudioHost() to
// re-attach an existing element if its parentNode goes null.
//
// Different streams (live, archive radio, single-archive, browsing-mode
// preview) get separate hosts by id so they don't share a parent.

export function getAudioHost(hostId: string): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  let host = document.getElementById(hostId) as HTMLDivElement | null;
  if (!host) {
    host = document.createElement('div');
    host.id = hostId;
    host.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;pointer-events:none;';
    document.body.appendChild(host);
  }
  return host;
}

export function attachToAudioHost(el: HTMLAudioElement, hostId: string): void {
  const host = getAudioHost(hostId);
  if (host) host.appendChild(el);
}

export function createHostedAudio(hostId: string): HTMLAudioElement {
  const el = new Audio();
  attachToAudioHost(el, hostId);
  return el;
}
