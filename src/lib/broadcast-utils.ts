import { BroadcastSlotSerialized } from '@/types/broadcast';

/**
 * Delay (ms) applied to slot transitions in listener-facing UI so the old DJ's
 * info lingers briefly after the new slot starts, covering audio handoff lag.
 */
export const SLOT_TRANSITION_DELAY_MS = 6000;

/** Find the active DJ slot for listener UI, applying the transition delay. */
export function findActiveDjSlot<T extends { startTime: number; endTime: number }>(
  slots: T[],
  now: number = Date.now(),
): T | undefined {
  const shifted = now - SLOT_TRANSITION_DELAY_MS;
  return slots.find(s => s.startTime <= shifted && s.endTime > shifted);
}

/** Normalize a DJ username for chat room lookup */
function normalize(u: string): string {
  return u.replace(/[\s-]+/g, '').toLowerCase();
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
