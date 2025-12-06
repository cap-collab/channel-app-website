"use client";

import { useState, useEffect, useCallback } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, googleProvider } from "@/lib/firebase";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!auth) {
      setState({ user: null, loading: false, error: "Auth not configured" });
      return;
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        setState({ user, loading: false, error: null });
      },
      (error) => {
        console.error("Auth state change error:", error);
        setState({ user: null, loading: false, error: error.message });
      }
    );

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!auth || !googleProvider || !db) {
      setState((prev) => ({
        ...prev,
        error: "Authentication not configured",
      }));
      return null;
    }

    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      // Create or update user document in Firestore
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        // New user - create document
        await setDoc(userRef, {
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          emailNotifications: {
            showStarting: false,
            watchlistMatch: false,
          },
        });
      } else {
        // Existing user - update last seen
        await setDoc(
          userRef,
          {
            lastSeenAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      setState({ user, loading: false, error: null });
      return user;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sign in";
      console.error("Sign in error:", error);
      setState((prev) => ({ ...prev, loading: false, error: message }));
      return null;
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!auth) return;

    try {
      await firebaseSignOut(auth);
      setState({ user: null, loading: false, error: null });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sign out";
      console.error("Sign out error:", error);
      setState((prev) => ({ ...prev, error: message }));
    }
  }, []);

  return {
    user: state.user,
    loading: state.loading,
    error: state.error,
    signInWithGoogle,
    signOut,
    isAuthenticated: !!state.user,
  };
}
