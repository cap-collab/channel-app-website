import { ArchiveDJ } from '@/types/broadcast';

function removeUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T;
}

/** Extract DJ entries for an archive doc from a broadcast slot.
 *  Used by the LiveKit egress_ended webhook (primary path) and the manual
 *  /api/archives/create fallback. */
export function extractDJs(slotData: Record<string, unknown>): ArchiveDJ[] {
  const djs: ArchiveDJ[] = [];

  // Venue broadcasts with djSlots
  if (slotData.djSlots && Array.isArray(slotData.djSlots)) {
    for (const slot of slotData.djSlots) {
      // B3B: multiple DJs sharing one slot
      if (slot.djProfiles && Array.isArray(slot.djProfiles)) {
        for (const profile of slot.djProfiles) {
          if (profile.username || profile.email || profile.userId) {
            djs.push(removeUndefined({
              name: profile.username || slot.djName || 'Unknown DJ',
              username: profile.username || undefined,
              userId: profile.userId || undefined,
              photoUrl: profile.photoUrl || undefined,
            }));
          }
        }
      } else if (slot.djName) {
        djs.push(removeUndefined({
          name: slot.djName,
          username: slot.djUsername || undefined,
          userId: slot.djUserId || slot.liveDjUserId || undefined,
          photoUrl: slot.djPhotoUrl || undefined,
        }));
      }
    }
  }

  // Flat fallback: remote / restream broadcasts
  if (djs.length === 0) {
    const djName = slotData.liveDjUsername || slotData.djName || slotData.djUsername;
    if (djName) {
      djs.push(removeUndefined({
        name: djName as string,
        username: (slotData.djUsername || slotData.liveDjUsername) as string | undefined,
        userId: (slotData.liveDjUserId || slotData.djUserId) as string | undefined,
        photoUrl: slotData.liveDjPhotoUrl as string | undefined,
      }));
    }
  }

  return djs;
}
