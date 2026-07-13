import { Timestamp } from 'firebase-admin/firestore';
import { getLinkedIdentity } from '@/lib/account-links';
import { normalizeUsername } from '@/lib/dj-matching';

/**
 * Resident booking window.
 *
 * Residents self-book their next show from /studio. To keep a residency on
 * cadence, the calendar can't offer a date that lands too soon after their last
 * show: a monthly resident must leave 30 days, a quarterly one 120 days.
 *
 * This is a floor on the DATES they may pick, not a lock on the form — a monthly
 * resident whose last show was 20 days ago can still book today, just not for a
 * date earlier than 10 days out. A resident with no history at all books freely.
 *
 * "Last show" = the most recent of their last live broadcast (a slot that has
 * ended, or is on air now) and their last archive upload — mirroring how the
 * resident-reschedule cron defines activity, including credit via any collective
 * they own.
 */

export type ResidencyCadence = 'monthly' | 'quarterly';

const COOLDOWN_DAYS: Record<ResidencyCadence, number> = {
  monthly: 30,
  quarterly: 120,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BookingWindow {
  /** Residency cadence, or null if this DJ isn't a resident (can't self-book). */
  cadence: ResidencyCadence | null;
  /** Millis of their most recent show (live slot or upload), or null if none. */
  lastShowAt: number | null;
  /** Required gap in days for this cadence — null when not a resident. */
  cooldownDays: number | null;
  /**
   * Earliest bookable start, in millis: lastShowAt + cooldown. Null when there's
   * no history (no floor beyond the picker's usual rules) or not a resident.
   */
  earliestStart: number | null;
}

function toMillis(t: unknown): number | null {
  if (t && typeof t === 'object' && 'toMillis' in t) return (t as Timestamp).toMillis();
  if (typeof t === 'number') return t;
  return null;
}

// Loose Firestore admin type — keeps this module importable without pulling in
// a concrete firebase-admin instance.
type Db = FirebaseFirestore.Firestore;

/**
 * Compute the booking window for a signed-in DJ.
 *
 * `uid` may be an alias login — the residency + history are read against the
 * primary and all linked accounts, so a DJ can't reset their own cooldown by
 * booking from their second account.
 */
export async function getResidentBookingWindow(db: Db, uid: string): Promise<BookingWindow> {
  const notResident: BookingWindow = {
    cadence: null,
    lastShowAt: null,
    cooldownDays: null,
    earliestStart: null,
  };

  const getUser = async (id: string) => {
    const snap = await db.collection('users').doc(id).get();
    const data = snap.data();
    return data ? { primaryUid: data.primaryUid, aliasUids: data.aliasUids, email: data.email } : null;
  };

  const { primaryUid, uids } = await getLinkedIdentity(getUser, uid);

  const primarySnap = await db.collection('users').doc(primaryUid).get();
  const primary = primarySnap.data();
  if (!primary) return notResident;

  const raw = primary.djProfile?.residency?.cadence;
  if (raw !== 'monthly' && raw !== 'quarterly') return notResident;
  const cadence: ResidencyCadence = raw;

  // ── Identity: the uids, usernames and owned-collective slugs a show may be
  // credited to. Same resolution as the resident-reschedule cron.
  const uidSet = new Set(uids);
  const usernames = new Set<string>();
  for (const id of uids) {
    const snap = id === primaryUid ? primarySnap : await db.collection('users').doc(id).get();
    const data = snap.data();
    if (!data) continue;
    for (const u of [data.chatUsernameNormalized, data.chatUsername]) {
      if (typeof u === 'string' && u.trim()) usernames.add(normalizeUsername(u));
    }
    // Collectives this DJ owns: their shows/uploads are credited to the slug,
    // not to a uid (a collective isn't a user).
    const ownedSlugs = Array.isArray(data.ownedCollectiveSlugs) ? data.ownedCollectiveSlugs : [];
    for (const s of ownedSlugs) {
      if (typeof s === 'string' && s.trim()) usernames.add(normalizeUsername(s));
    }
  }

  const isMine = (djUserId?: unknown, djUsername?: unknown): boolean => {
    if (typeof djUserId === 'string' && uidSet.has(djUserId)) return true;
    if (typeof djUsername === 'string' && djUsername.trim()) {
      return usernames.has(normalizeUsername(djUsername));
    }
    return false;
  };

  const now = Date.now();
  let lastShowAt: number | null = null;
  const mark = (ms: number | null) => {
    if (ms !== null && ms <= now && (lastShowAt === null || ms > lastShowAt)) lastShowAt = ms;
  };

  // ── Last live broadcast ────────────────────────────────────────────────
  // A slot counts once it has ended; one on air right now counts as of its
  // start. Cancelled slots and audio-capture recordings aren't shows.
  const slotsSnap = await db.collection('broadcast-slots').get();
  for (const doc of slotsSnap.docs) {
    const slot = doc.data();
    if (slot.status === 'cancelled' || slot.broadcastType === 'recording') continue;

    const slotStart = toMillis(slot.startTime);
    const slotEnd = toMillis(slot.endTime);

    const markShow = (startMs: number | null, endMs: number | null) => {
      if (endMs !== null && endMs <= now) mark(endMs);
      else if (startMs !== null && startMs <= now) mark(startMs); // live right now
    };

    if (isMine(slot.djUserId, slot.djUsername) || isMine(slot.liveDjUserId, slot.liveDjUsername)) {
      markShow(slotStart, slotEnd);
    }

    // Multi-DJ venue slots carry their own per-DJ times.
    const djSlots = Array.isArray(slot.djSlots) ? slot.djSlots : [];
    for (const ds of djSlots) {
      if (!isMine(ds.djUserId, ds.djUsername)) continue;
      markShow(toMillis(ds.startTime) ?? slotStart, toMillis(ds.endTime) ?? slotEnd);
    }
  }

  // ── Last upload ────────────────────────────────────────────────────────
  // archives.createdAt is stored inconsistently (millis from the upload path,
  // Timestamp from live-recorded shows), so it can't be filtered server-side —
  // sweep and normalize in memory.
  const archivesSnap = await db.collection('archives').get();
  for (const doc of archivesSnap.docs) {
    const arch = doc.data();
    const createdAt = toMillis(arch.createdAt);
    if (createdAt === null) continue;
    const djs = Array.isArray(arch.djs) ? arch.djs : [];
    const mine =
      djs.some((dj: { userId?: unknown; username?: unknown }) => isMine(dj.userId, dj.username)) ||
      (typeof arch.uploadedBy === 'string' && uidSet.has(arch.uploadedBy));
    if (mine) mark(createdAt);
  }

  const cooldownDays = COOLDOWN_DAYS[cadence];

  return {
    cadence,
    lastShowAt,
    cooldownDays,
    // No history → no floor at all.
    earliestStart: lastShowAt === null ? null : lastShowAt + cooldownDays * DAY_MS,
  };
}
