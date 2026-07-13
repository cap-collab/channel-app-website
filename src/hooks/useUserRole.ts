import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';

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

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    // Subscribe to whichever doc owns the role: the primary for an alias login,
    // otherwise the login's own doc.
    const subscribe = (uid: string) => {
      if (cancelled || !db) return;
      unsubscribe = onSnapshot(
        doc(db, 'users', uid),
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            setRole(data.role || 'user');
          } else {
            setRole('user');
          }
          setLoading(false);
        },
        (error) => {
          console.error('Error fetching user role:', error);
          setRole('user');
          setLoading(false);
        }
      );
    };

    // Resolve alias → primary once, then subscribe. On any read error, fall back
    // to the login's own doc so a failure can never lock a DJ out.
    getDoc(doc(db, 'users', user.uid))
      .then((snap) => {
        const primaryUid = snap.data()?.primaryUid as string | undefined;
        subscribe(primaryUid && primaryUid !== user.uid ? primaryUid : user.uid);
      })
      .catch((error) => {
        console.error('Error resolving linked account:', error);
        subscribe(user.uid);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
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
