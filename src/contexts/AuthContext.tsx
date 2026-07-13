"use client";

import { createContext, useContext, useMemo, ReactNode } from "react";
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

  // Memoized so a re-render of AuthProvider doesn't hand every consumer a new
  // context object. useAuth's callbacks are already useCallback-stable, so the
  // value only changes when auth state actually changes.
  const value = useMemo(
    () => ({ ...auth, activityUid: effectiveUid }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      auth.user,
      auth.loading,
      auth.error,
      auth.emailSent,
      auth.passwordResetSent,
      auth.isAuthenticated,
      effectiveUid,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
}
