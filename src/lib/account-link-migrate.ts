import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

// Link-time migration (see src/lib/account-links.ts for the model).
//
// An ALIAS is only a LOGIN — a doorway into the primary account. It holds no
// identity and no history of its own: signing in with it simply makes you the
// primary. So at link time we move whatever the alias already accumulated onto
// the primary, then strip the alias's identity fields so nothing can resolve to
// it any more.
//
// Everything here is idempotent and additive: engagement counters are merged
// (loves/streams sum, earliest "first" timestamp and latest "last" timestamp
// win), and content is re-pointed rather than duplicated. Re-running is safe.
//
// Per the repo rule, we never write a whole doc back wholesale — every write is
// a targeted .set(merge) / .update() of the specific fields that change.

export interface MigrationSummary {
  loveHistory: number;
  streamHistory: number;
  tracklistViews: number;
  playedArchives: number;
  playedSlots: number;
  favorites: number;
  archivesUploaded: number;
  archivesCredited: number;
  studioSessions: number;
  broadcastSlots: number;
  tips: number;
  crossLists: number;
  identityStripped: boolean;
}

const emptySummary = (): MigrationSummary => ({
  loveHistory: 0,
  streamHistory: 0,
  tracklistViews: 0,
  playedArchives: 0,
  playedSlots: 0,
  favorites: 0,
  archivesUploaded: 0,
  archivesCredited: 0,
  studioSessions: 0,
  broadcastSlots: 0,
  tips: 0,
  crossLists: 0,
  identityStripped: false,
});

/** Smaller of two millisecond stamps, ignoring nullish. */
function earliest(a: unknown, b: unknown): unknown {
  const am = toMs(a);
  const bm = toMs(b);
  if (am == null) return b;
  if (bm == null) return a;
  return am <= bm ? a : b;
}
function latest(a: unknown, b: unknown): unknown {
  const am = toMs(a);
  const bm = toMs(b);
  if (am == null) return b;
  if (bm == null) return a;
  return am >= bm ? a : b;
}
function toMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const o = v as { toMillis?: () => number; _seconds?: number; seconds?: number };
  if (typeof o.toMillis === 'function') return o.toMillis();
  if (typeof o._seconds === 'number') return o._seconds * 1000;
  if (typeof o.seconds === 'number') return o.seconds * 1000;
  return null;
}

/**
 * Move every trace of `aliasUid` onto `primaryUid`.
 *
 * `dryRun` reports what WOULD move without writing anything — always run this
 * first when migrating a real account.
 */
export async function migrateAliasToPrimary(
  db: Firestore,
  aliasUid: string,
  primaryUid: string,
  opts: { dryRun?: boolean } = {},
): Promise<MigrationSummary> {
  const dryRun = opts.dryRun === true;
  const s = emptySummary();
  if (!aliasUid || !primaryUid || aliasUid === primaryUid) return s;

  const aliasRef = db.collection('users').doc(aliasUid);
  const primaryRef = db.collection('users').doc(primaryUid);

  // ── 1. Engagement subcollections ────────────────────────────────────────────
  // loveHistory: doc id = DJ username. Merge counters rather than overwrite, so
  // a DJ loved from BOTH accounts ends up with the combined count.
  const loveSnap = await aliasRef.collection('loveHistory').get();
  for (const d of loveSnap.docs) {
    s.loveHistory++;
    if (dryRun) continue;
    const a = d.data();
    const targetRef = primaryRef.collection('loveHistory').doc(d.id);
    const existing = (await targetRef.get()).data();
    await targetRef.set(
      {
        ...a,
        loveCount: ((existing?.loveCount as number) ?? 0) + ((a.loveCount as number) ?? 0),
        contexts: FieldValue.arrayUnion(...((a.contexts as string[]) ?? [])),
        firstLovedAt: earliest(existing?.firstLovedAt, a.firstLovedAt),
        lastLovedAt: latest(existing?.lastLovedAt, a.lastLovedAt),
      },
      { merge: true },
    );
    await d.ref.delete();
  }

  // streamHistory: doc id = archiveId/slotId. Same merge shape.
  const streamSnap = await aliasRef.collection('streamHistory').get();
  for (const d of streamSnap.docs) {
    s.streamHistory++;
    if (dryRun) continue;
    const a = d.data();
    const targetRef = primaryRef.collection('streamHistory').doc(d.id);
    const existing = (await targetRef.get()).data();
    await targetRef.set(
      {
        ...a,
        streamCount: ((existing?.streamCount as number) ?? 0) + ((a.streamCount as number) ?? 0),
        firstStreamedAt: earliest(existing?.firstStreamedAt, a.firstStreamedAt),
        lastStreamedAt: latest(existing?.lastStreamedAt, a.lastStreamedAt),
      },
      { merge: true },
    );
    await d.ref.delete();
  }

  // tracklistViews: doc id = archiveId.
  const viewSnap = await aliasRef.collection('tracklistViews').get();
  for (const d of viewSnap.docs) {
    s.tracklistViews++;
    if (dryRun) continue;
    const a = d.data();
    const targetRef = primaryRef.collection('tracklistViews').doc(d.id);
    const existing = (await targetRef.get()).data();
    await targetRef.set(
      {
        ...a,
        viewCount: ((existing?.viewCount as number) ?? 0) + ((a.viewCount as number) ?? 0),
        firstViewedAt: earliest(existing?.firstViewedAt, a.firstViewedAt),
        lastViewedAt: latest(existing?.lastViewedAt, a.lastViewedAt),
      },
      { merge: true },
    );
    await d.ref.delete();
  }

  // playedSlots: exclusion markers, doc id = slotId. Straight copy.
  const playedSlotSnap = await aliasRef.collection('playedSlots').get();
  for (const d of playedSlotSnap.docs) {
    s.playedSlots++;
    if (dryRun) continue;
    await primaryRef.collection('playedSlots').doc(d.id).set(d.data(), { merge: true });
    await d.ref.delete();
  }

  // favorites / watchlist: auto-id docs — copy across, don't dedupe by id.
  const favSnap = await aliasRef.collection('favorites').get();
  for (const d of favSnap.docs) {
    s.favorites++;
    if (dryRun) continue;
    await primaryRef.collection('favorites').doc(d.id).set(d.data(), { merge: true });
    await d.ref.delete();
  }

  // ── 2. User-doc maps (played/dismissed archives) ────────────────────────────
  const aliasData = (await aliasRef.get()).data() ?? {};
  const playedMap = (aliasData.playedArchiveIds as Record<string, unknown>) ?? {};
  const dismissedMap = (aliasData.dismissedArchiveIds as Record<string, unknown>) ?? {};
  s.playedArchives = Object.keys(playedMap).length;
  if (!dryRun && (Object.keys(playedMap).length > 0 || Object.keys(dismissedMap).length > 0)) {
    const merge: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(playedMap)) merge[`playedArchiveIds.${k}`] = v;
    for (const [k, v] of Object.entries(dismissedMap)) merge[`dismissedArchiveIds.${k}`] = v;
    await primaryRef.update(merge);
  }

  // ── 3. Content ownership ────────────────────────────────────────────────────
  // Uploaded recordings: uploadedBy + the djs[0] owner entry.
  const uploadedSnap = await db.collection('archives').where('uploadedBy', '==', aliasUid).get();
  for (const d of uploadedSnap.docs) {
    s.archivesUploaded++;
    if (dryRun) continue;
    await d.ref.update({ uploadedBy: primaryUid });
  }

  // Any archive crediting the alias in djs[] (live recordings, co-credits).
  // djs is an array of objects → Firestore can't query inside it; scan and patch
  // only the entries that name the alias.
  const allArchives = await db.collection('archives').get();
  for (const d of allArchives.docs) {
    const djs = (d.data().djs ?? []) as { userId?: string }[];
    if (!Array.isArray(djs) || !djs.some((dj) => dj?.userId === aliasUid)) continue;
    s.archivesCredited++;
    if (dryRun) continue;
    const patched = djs.map((dj) => (dj?.userId === aliasUid ? { ...dj, userId: primaryUid } : dj));
    await d.ref.update({ djs: patched });
  }

  // Cross-listing by uid.
  const crossSnap = await db
    .collection('archives')
    .where('crossListUserIds', 'array-contains', aliasUid)
    .get();
  for (const d of crossSnap.docs) {
    s.crossLists++;
    if (dryRun) continue;
    await d.ref.update({
      crossListUserIds: FieldValue.arrayRemove(aliasUid),
    });
    await d.ref.update({
      crossListUserIds: FieldValue.arrayUnion(primaryUid),
    });
  }

  // Studio sessions.
  const sessSnap = await db.collection('studio-sessions').where('djUserId', '==', aliasUid).get();
  for (const d of sessSnap.docs) {
    s.studioSessions++;
    if (dryRun) continue;
    await d.ref.update({ djUserId: primaryUid });
  }

  // Broadcast slots (both the booked DJ and the live DJ pointer).
  for (const field of ['djUserId', 'liveDjUserId'] as const) {
    const slotSnap = await db.collection('broadcast-slots').where(field, '==', aliasUid).get();
    for (const d of slotSnap.docs) {
      s.broadcastSlots++;
      if (dryRun) continue;
      await d.ref.update({ [field]: primaryUid });
    }
  }

  // Tips.
  const tipSnap = await db.collection('tips').where('djUserId', '==', aliasUid).get();
  for (const d of tipSnap.docs) {
    s.tips++;
    if (dryRun) continue;
    await d.ref.update({ djUserId: primaryUid });
  }

  // ── 4. Strip the alias's identity ───────────────────────────────────────────
  // The alias is a doorway, not a person: it must not resolve as a DJ, own a
  // username, or carry a profile. Its `usernames/{handle}` reservation is
  // released so the handle isn't held hostage by a login that can't use it.
  if (!dryRun) {
    const handle = aliasData.chatUsernameNormalized as string | undefined;
    if (handle) {
      const handleRef = db.collection('usernames').doc(handle);
      const handleDoc = await handleRef.get();
      if (handleDoc.exists && handleDoc.data()?.uid === aliasUid) {
        await handleRef.delete();
      }
    }
    await aliasRef.update({
      role: 'user',
      chatUsername: FieldValue.delete(),
      chatUsernameNormalized: FieldValue.delete(),
      djProfile: FieldValue.delete(),
      ownedCollectiveSlugs: FieldValue.delete(),
      playedArchiveIds: FieldValue.delete(),
      dismissedArchiveIds: FieldValue.delete(),
    });
    s.identityStripped = true;
  }

  return s;
}
