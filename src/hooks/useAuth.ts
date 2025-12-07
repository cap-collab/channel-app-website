"use client";

import { useState, useEffect, useCallback } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, googleProvider } from "@/lib/firebase";

const EMAIL_FOR_SIGN_IN_KEY = "emailForSignIn";
const NOTIFICATIONS_PREF_KEY = "notificationsPref";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  emailSent: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
    emailSent: false,
  });

  // Handle email link sign-in on page load
  useEffect(() => {
    if (!auth || !db) return;

    const handleEmailLinkSignIn = async () => {
      if (isSignInWithEmailLink(auth, window.location.href)) {
        let email = window.localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY);
        const enableNotifications = window.localStorage.getItem(NOTIFICATIONS_PREF_KEY) === "true";

        if (!email) {
          // User opened the link on a different device
          email = window.prompt("Please provide your email for confirmation");
        }

        if (email) {
          try {
            setState((prev) => ({ ...prev, loading: true }));
            const result = await signInWithEmailLink(auth, email, window.location.href);
            const user = result.user;

            // Create or update user document
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
              await setDoc(userRef, {
                email: user.email,
                displayName: user.email?.split("@")[0] || "User",
                photoURL: null,
                createdAt: serverTimestamp(),
                lastSeenAt: serverTimestamp(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                emailNotifications: {
                  showStarting: enableNotifications,
                  watchlistMatch: enableNotifications,
                },
              });
            } else {
              const updateData: Record<string, unknown> = {
                lastSeenAt: serverTimestamp(),
              };
              if (enableNotifications) {
                updateData.emailNotifications = {
                  showStarting: true,
                  watchlistMatch: true,
                };
              }
              await setDoc(userRef, updateData, { merge: true });
            }

            // Clear stored email and preferences
            window.localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY);
            window.localStorage.removeItem(NOTIFICATIONS_PREF_KEY);

            // Clean up URL
            window.history.replaceState(null, "", window.location.pathname);

            setState({ user, loading: false, error: null, emailSent: false });
          } catch (error) {
            console.error("Email link sign-in error:", error);
            setState((prev) => ({
              ...prev,
              loading: false,
              error: "Failed to sign in with email link. Please try again.",
            }));
          }
        }
      }
    };

    handleEmailLinkSignIn();
  }, []);

  useEffect(() => {
    if (!auth) {
      setState({ user: null, loading: false, error: null, emailSent: false });
      return;
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        setState((prev) => ({ ...prev, user, loading: false, error: null }));
      },
      (error) => {
        console.error("Auth state change error:", error);
        setState((prev) => ({ ...prev, user: null, loading: false, error: error.message }));
      }
    );

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async (enableNotifications = false) => {
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
        // New user - create document with notification preference
        await setDoc(userRef, {
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          emailNotifications: {
            showStarting: enableNotifications,
            watchlistMatch: enableNotifications,
          },
        });
      } else {
        // Existing user - update last seen
        // If they opted in during this sign-in, enable notifications
        const updateData: Record<string, unknown> = {
          lastSeenAt: serverTimestamp(),
        };
        if (enableNotifications) {
          updateData.emailNotifications = {
            showStarting: true,
            watchlistMatch: true,
          };
        }
        await setDoc(userRef, updateData, { merge: true });
      }

      setState({ user, loading: false, error: null, emailSent: false });
      return user;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sign in";
      console.error("Sign in error:", error);
      setState((prev) => ({ ...prev, loading: false, error: message }));
      return null;
    }
  }, []);

  const sendEmailLink = useCallback(async (email: string, enableNotifications = false) => {
    if (!auth) {
      setState((prev) => ({
        ...prev,
        error: "Authentication not configured",
      }));
      return false;
    }

    const actionCodeSettings = {
      url: window.location.origin + "/djshows",
      handleCodeInApp: true,
    };

    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      await sendSignInLinkToEmail(auth, email, actionCodeSettings);

      // Store email and notification preference for after sign-in
      window.localStorage.setItem(EMAIL_FOR_SIGN_IN_KEY, email);
      window.localStorage.setItem(NOTIFICATIONS_PREF_KEY, enableNotifications.toString());

      setState((prev) => ({ ...prev, loading: false, emailSent: true }));
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send sign-in email";
      console.error("Email sign-in error:", error);
      setState((prev) => ({ ...prev, loading: false, error: message }));
      return false;
    }
  }, []);

  const resetEmailSent = useCallback(() => {
    setState((prev) => ({ ...prev, emailSent: false, error: null }));
  }, []);

  const signOut = useCallback(async () => {
    if (!auth) return;

    try {
      await firebaseSignOut(auth);
      setState({ user: null, loading: false, error: null, emailSent: false });
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
    emailSent: state.emailSent,
    signInWithGoogle,
    sendEmailLink,
    resetEmailSent,
    signOut,
    isAuthenticated: !!state.user,
  };
}
