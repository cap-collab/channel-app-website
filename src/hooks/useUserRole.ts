import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

export type UserRole = 'broadcaster' | 'admin' | 'dj' | 'user' | null;

interface UserRoleData {
  role: UserRole;
  loading: boolean;
}

/**
 * Hook to check user's role from Firestore
 * Uses onSnapshot for real-time updates (e.g. after DJ role assignment)
 *
 * Linked accounts: if this login is an ALIAS (its user doc carries a
 * `primaryUid`), the role is read from the PRIMARY instead — so a DJ signing in
 * with their personal-email account inherits their DJ role. See
 * src/lib/account-links.ts.
 */
export function useUserRole(user: User | null): UserRoleData {
  const [role, setRole] = useState<UserRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !db) {
      setRole(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let unsubOwn: (() => void) | undefined;
    let unsubPrimary: (() => void) | undefined;

    // Subscribe to the login's OWN doc straight away — no pre-resolve round-trip,
    // so an ordinary user's role resolves exactly as fast as it always did.
    // If that doc turns out to be an ALIAS, re-point to the primary using the
    // primaryUid we just received (an alias's own `role` is meaningless: the
    // link migration demotes it to 'user').
    // eslint-disable-next-line prefer-const
    unsubOwn = onSnapshot(
      doc(db, 'users', user.uid),
      (snapshot) => {
        if (cancelled || !db) return;
        const data = snapshot.data();
        const primaryUid = data?.primaryUid as string | undefined;

        if (primaryUid && primaryUid !== user.uid) {
          // Alias → the role lives on the primary. Subscribe once.
          if (!unsubPrimary) {
            unsubPrimary = onSnapshot(
              doc(db, 'users', primaryUid),
              (primarySnap) => {
                setRole((primarySnap.data()?.role as UserRole) || 'user');
                setLoading(false);
              },
              (error) => {
                console.error('Error fetching primary role:', error);
                setRole('user');
                setLoading(false);
              },
            );
          }
          return;
        }

        setRole(snapshot.exists() ? data?.role || 'user' : 'user');
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching user role:', error);
        setRole('user');
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
      unsubOwn?.();
      unsubPrimary?.();
    };
  }, [user]);

  return { role, loading };
}

/**
 * Check if user has broadcaster access (admin dashboard)
 */
export function isBroadcaster(role: UserRole): boolean {
  return role === 'broadcaster' || role === 'admin';
}

/**
 * Check if user has DJ access (DJ profile, broadcast features)
 * Includes dj, broadcaster, and admin roles
 */
export function isDJ(role: UserRole): boolean {
  return role === 'dj' || role === 'broadcaster' || role === 'admin';
}
