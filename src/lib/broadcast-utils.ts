import { BroadcastSlotSerialized } from '@/types/broadcast';
import { normalizeUsername } from '@/lib/dj-matching';

/**
 * Delay (ms) applied to slot transitions in listener-facing UI so the old DJ's
 * info lingers briefly after the new slot starts, covering audio handoff lag.
 * Matched to the iOS HLS buffer headroom (see useBroadcastStream.ts) so the
 * image swap stays roughly in sync with what mobile listeners actually hear.
 */
export const SLOT_TRANSITION_DELAY_MS = 8000;

/** Find the active DJ slot for listener UI, applying the transition delay. */
export function findActiveDjSlot<T extends { startTime: number; endTime: number }>(
  slots: T[],
  now: number = Date.now(),
): T | undefined {
  const shifted = now - SLOT_TRANSITION_DELAY_MS;
  return slots.find(s => s.startTime <= shifted && s.endTime > shifted);
}

/** Normalize a DJ username for chat room lookup.
 *  Must match `chatUsernameNormalized` / collective `slug` exactly, which strip
 *  ALL non-alphanumerics including dots (see normalizeUsername / generateSlug).
 *  Using the canonical helper keeps the live chat room aligned with the per-DJ
 *  room and the collective slug — a dotted name like "B. Rod b2b David L"
 *  resolves to "brodb2bdavidl", not "b.rodb2bdavidl". A narrower [\s-] strip
 *  here is what split the collective chat into a phantom dotted room and broke
 *  the post-show copy-to-owners fan-out. */
function normalize(u: string): string {
  return normalizeUsername(u);
}

/** Compute the current DJ's chat room from live broadcast data.
 *  For venue shows with multiple DJ slots, returns the current slot's DJ. */
export function computeDJChatRoom(currentShow: BroadcastSlotSerialized | null): string {
  if (!currentShow) return '';
  if (currentShow.djSlots && currentShow.djSlots.length > 0) {
    const slot = findActiveDjSlot(currentShow.djSlots);
    const username = slot?.liveDjUsername || slot?.djUsername || slot?.djName;
    if (username) return normalize(username);
  }
  const username = currentShow.liveDjUsername || currentShow.djUsername || currentShow.djName;
  return username ? normalize(username) : '';
}
