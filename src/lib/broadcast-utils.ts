import { BroadcastSlotSerialized } from '@/types/broadcast';

/** Normalize a DJ username for chat room lookup */
function normalize(u: string): string {
  return u.replace(/[\s-]+/g, '').toLowerCase();
}

/** Compute the current DJ's chat room from live broadcast data.
 *  For venue shows with multiple DJ slots, returns the current slot's DJ. */
export function computeDJChatRoom(currentShow: BroadcastSlotSerialized | null): string {
  if (!currentShow) return '';
  if (currentShow.djSlots && currentShow.djSlots.length > 0) {
    const now = Date.now();
    const slot = currentShow.djSlots.find(s => s.startTime <= now && s.endTime > now);
    const username = slot?.liveDjUsername || slot?.djUsername || slot?.djName;
    if (username) return normalize(username);
  }
  const username = currentShow.liveDjUsername || currentShow.djUsername || currentShow.djName;
  return username ? normalize(username) : '';
}
