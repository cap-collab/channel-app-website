"use client";

import { createContext, useContext, ReactNode } from "react";
import { User } from "firebase/auth";
import { useAuth } from "@/hooks/useAuth";
import { useLinkedIdentity } from "@/hooks/useLinkedIdentity";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  emailSent: boolean;
  passwordResetSent: boolean;
  /**
   * The uid a person's ACTIVITY belongs to. An alias account is only a login —
   * a doorway into a primary account — so every engagement write (loves,
   * favorites, watchlist, mutes, taste prefs) must be recorded under this uid,
   * NOT `user.uid`, or a person's history splits across their two accounts.
   *
   * For an ordinary (unlinked) user this IS `user.uid`, so it's always safe to
   * use in place of it. Null while auth/link resolution is still loading.
   * See src/lib/account-links.ts.
   */
  activityUid: string | null;
  signInWithGoogle: (enableNotifications?: boolean, djUsername?: string) => Promise<User | null>;
  signInWithApple: (enableNotifications?: boolean, djUsername?: string) => Promise<User | null>;
  sendEmailLink: (email: string, enableNotifications?: boolean) => Promise<boolean>;
  resetEmailSent: () => void;
  checkEmailMethods: (email: string) => Promise<string[]>;
  signInWithPassword: (email: string, password: string, enableNotifications?: boolean) => Promise<User | null>;
  createAccountWithPassword: (email: string, password: string, enableNotifications?: boolean) => Promise<User | null>;
  signInOrCreateWithPassword: (email: string, password: string, enableNotifications?: boolean) => Promise<User | null>;
  sendPasswordReset: (email: string) => Promise<boolean>;
  resetPasswordResetSent: () => void;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  // Resolve alias → primary ONCE here, so every consumer gets the right uid to
  // record activity under without each hook re-reading the user doc.
  const { effectiveUid } = useLinkedIdentity(auth.user);

  // CRITICAL: fall back to the login's own uid while the alias lookup is still
  // in flight. Resolution costs a network round-trip, so `effectiveUid` is null
  // for the first few hundred ms AFTER auth restores — and callers guard on
  // `activityUid`. Without this fallback, a heart / follow / mute clicked in
  // that window silently no-ops (the UI animates, nothing is written).
  //
  // For an UNLINKED user this is provably identical to the old `user.uid`
  // behaviour. For an alias it means writes made in that sliver land on the
  // alias — which link-time migration already sweeps onto the primary — and
  // that is strictly better than dropping them.
  const activityUid = effectiveUid ?? auth.user?.uid ?? null;

  return (
    <AuthContext.Provider value={{ ...auth, activityUid }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
}
