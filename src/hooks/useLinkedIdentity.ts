import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { MAX_LINKED_UIDS } from '@/lib/account-links';

/**
 * Resolves a login to the DJ/user it actually operates as.
 *
 * A DJ may have a second Firebase Auth account (e.g. their personal email).
 * The secondary account is an ALIAS pointing at a canonical PRIMARY via
 * `primaryUid`; the primary carries the reverse index `aliasUids[]`. See
 * src/lib/account-links.ts for the model.
 *
 * - `effectiveUid` — the uid to READ/WRITE profile data as (the primary).
 * - `linkedUids`   — primary + all its aliases, for expanding uid-keyed reads
 *                    (`where(field, 'in', linkedUids)`). Always ≥ 1 entry.
 * - `linkedEmails` — the same set's emails (lowercased), for djEmail-keyed reads.
 *
 * For an unlinked account these collapse to just that user, so callers can use
 * them unconditionally.
 */
export interface LinkedIdentity {
  effectiveUid: string | null;
  linkedUids: string[];
  linkedEmails: string[];
  isAlias: boolean;
  loading: boolean;
}

export function useLinkedIdentity(user: User | null): LinkedIdentity {
  const [state, setState] = useState<LinkedIdentity>({
    effectiveUid: null,
    linkedUids: [],
    linkedEmails: [],
    isAlias: false,
    loading: true,
  });

  useEffect(() => {
    if (!user || !db) {
      setState({ effectiveUid: null, linkedUids: [], linkedEmails: [], isAlias: false, loading: false });
      return;
    }

    let cancelled = false;
    const ownEmail = user.email?.toLowerCase();
    // Capture the non-null db so the async closure below keeps the narrowed type.
    const firestore = db;

    // Safe fallback if anything below fails: operate as the login itself, so a
    // read error can never lock a DJ out of their own studio.
    const soloIdentity: LinkedIdentity = {
      effectiveUid: user.uid,
      linkedUids: [user.uid],
      linkedEmails: ownEmail ? [ownEmail] : [],
      isAlias: false,
      loading: false,
    };

    (async () => {
      try {
        const ownSnap = await getDoc(doc(firestore, "users", user.uid));
        const primaryUid = ownSnap.data()?.primaryUid as string | undefined;

        // Not an alias → the primary is this user; expand over its own aliases.
        const resolvedPrimary = primaryUid && primaryUid !== user.uid ? primaryUid : user.uid;
        const isAlias = resolvedPrimary !== user.uid;

        const primarySnap = isAlias ? await getDoc(doc(firestore, "users", resolvedPrimary)) : ownSnap;
        const primaryData = primarySnap.data();
        const aliasUids = ((primaryData?.aliasUids as string[] | undefined) ?? []).filter(Boolean);

        const uids = [resolvedPrimary, ...aliasUids].slice(0, MAX_LINKED_UIDS);

        // Emails we already hold: the primary's, plus this login's own.
        const emails = new Set<string>();
        const primaryEmail = (primaryData?.email as string | undefined)?.toLowerCase();
        if (primaryEmail) emails.add(primaryEmail);
        if (ownEmail) emails.add(ownEmail);
        // Remaining alias emails (skip the one we're logged in as — already added).
        await Promise.all(
          aliasUids
            .filter((a) => a !== user.uid)
            .map(async (a) => {
              const s = await getDoc(doc(firestore, "users", a));
              const e = (s.data()?.email as string | undefined)?.toLowerCase();
              if (e) emails.add(e);
            }),
        );

        if (cancelled) return;
        setState({
          effectiveUid: resolvedPrimary,
          linkedUids: uids,
          linkedEmails: Array.from(emails),
          isAlias,
          loading: false,
        });
      } catch (e) {
        console.error('[useLinkedIdentity] falling back to solo identity:', e);
        if (!cancelled) setState(soloIdentity);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  return state;
}
