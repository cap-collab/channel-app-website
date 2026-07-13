// Account linking (alias-uid model).
//
// A DJ (or any user) may have more than one Firebase Auth account — e.g. their
// original studio account plus a second one created later with a personal
// email. We keep ONE canonical *primary* user doc and point the others at it as
// *aliases*. The graph is strictly star-shaped, depth 1:
//
//   alias user doc:    { primaryUid: <primary>, aliasLinkedAt, aliasLinkedBy }
//   primary user doc:  { aliasUids: [<alias>, ...] }
//
// Invariants (enforced at link time in /api/admin/link-accounts):
//   - an alias never has aliasUids (can't be a primary)
//   - a primary never has primaryUid (can't be an alias)
//   - the effective uid set (primary + aliases) stays ≤ MAX_LINKED_UIDS so it
//     fits a single Firestore `in` query.
//
// These helpers are storage-agnostic: callers pass a `getUser` function that
// reads a `users/{uid}` doc, so the same logic serves both the admin SDK
// (server routes) and the client Firestore SDK (studio / useUserRole).

// Firestore `in` allows ≤ 30 values; keep the whole linked set within that so
// read-time `where(field, 'in', linkedUids)` never overflows.
export const MAX_LINKED_UIDS = 30;

export interface LinkFields {
  primaryUid?: string | null;
  aliasUids?: string[] | null;
  email?: string | null;
}

/** Minimal shape returned by a users/{uid} read, from either SDK. */
export type UserGetter = (uid: string) => Promise<LinkFields | null>;

/**
 * Resolve the canonical uid to operate as. If `uid` is an alias, returns its
 * primaryUid; otherwise returns `uid` unchanged.
 */
export async function resolvePrimaryUid(
  getUser: UserGetter,
  uid: string,
): Promise<{ primaryUid: string; isAlias: boolean }> {
  const data = await getUser(uid);
  const primaryUid = data?.primaryUid;
  if (primaryUid && primaryUid !== uid) {
    return { primaryUid, isAlias: true };
  }
  return { primaryUid: uid, isAlias: false };
}

/**
 * Admin-SDK convenience: resolve a uid to the account its ACTIVITY belongs to.
 *
 * A person may listen, love, and click track IDs while signed in with either of
 * their linked accounts. All of it must accrue to the ONE primary, or their
 * taste/engagement (and everything downstream — recommendations, go-live reach,
 * the admin Users tab) silently splits in two.
 *
 * Call this at the top of any server route that records per-user activity, right
 * after reading the uid. Never throws: on a read error it returns the uid
 * unchanged, so engagement is recorded against the login rather than dropped.
 *
 * `db` is a firebase-admin Firestore (typed loosely to keep this module free of
 * a hard firebase-admin import, so client code can import the model above).
 */
export async function resolveActivityUid(
  db: { collection: (p: string) => { doc: (id: string) => { get: () => Promise<{ data: () => Record<string, unknown> | undefined }> } } },
  uid: string,
): Promise<string> {
  if (!uid) return uid;
  try {
    const snap = await db.collection('users').doc(uid).get();
    const primaryUid = snap.data()?.primaryUid;
    return typeof primaryUid === 'string' && primaryUid && primaryUid !== uid ? primaryUid : uid;
  } catch {
    return uid;
  }
}

/**
 * The effective uid + email set for a login: the primary plus all its aliases.
 * Pass any linked uid (primary or alias) — it resolves to the primary first.
 * Use the returned `uids` in read-time `where(field, 'in', uids)` expansions and
 * `emails` for djEmail-keyed lookups (slots, tips). Emails are lowercased.
 */
export async function getLinkedIdentity(
  getUser: UserGetter,
  uid: string,
): Promise<{ primaryUid: string; uids: string[]; emails: string[] }> {
  const { primaryUid } = await resolvePrimaryUid(getUser, uid);
  const primary = await getUser(primaryUid);
  const aliasUids = (primary?.aliasUids ?? []).filter(Boolean);

  const uids = [primaryUid, ...aliasUids].slice(0, MAX_LINKED_UIDS);

  const emails = new Set<string>();
  const collect = (e?: string | null) => {
    if (e) emails.add(e.toLowerCase());
  };
  collect(primary?.email);
  // Alias emails require a read per alias; callers that already hold the docs
  // can pass them via a caching getUser. Kept simple and correct here.
  for (const a of aliasUids) {
    const doc = await getUser(a);
    collect(doc?.email);
  }

  return { primaryUid, uids, emails: Array.from(emails) };
}
