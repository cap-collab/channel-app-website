import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

export type UserRole = 'broadcaster' | 'admin' | 'user' | null;

interface UserRoleData {
  role: UserRole;
  loading: boolean;
}

/**
 * Hook to check user's role from Firestore
 * Checks the 'users' collection for a document with the user's UID
 * The document should have a 'role' field: 'broadcaster', 'admin', or 'user'
 */
export function useUserRole(user: User | null): UserRoleData {
  const [role, setRole] = useState<UserRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRole() {
      if (!user || !db) {
        setRole(null);
        setLoading(false);
        return;
      }

      try {
        // Check users collection for role
        const userDoc = await getDoc(doc(db, 'users', user.uid));

        if (userDoc.exists()) {
          const data = userDoc.data();
          setRole(data.role || 'user');
        } else {
          // No document = regular user
          setRole('user');
        }
      } catch (error) {
        console.error('Error fetching user role:', error);
        setRole('user');
      } finally {
        setLoading(false);
      }
    }

    fetchRole();
  }, [user]);

  return { role, loading };
}

/**
 * Check if user has broadcaster access
 */
export function isBroadcaster(role: UserRole): boolean {
  return role === 'broadcaster' || role === 'admin';
}
