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
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, googleProvider, appleProvider } from "@/lib/firebase";
import { getDefaultCity } from "@/lib/city-detection";

const EMAIL_FOR_SIGN_IN_KEY = "emailForSignIn";
const NOTIFICATIONS_PREF_KEY = "notificationsPref";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  emailSent: boolean;
  passwordResetSent: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
    emailSent: false,
    passwordResetSent: false,
  });

  // Handle email link sign-in on page load
  useEffect(() => {
    if (!auth || !db) return;

    // Capture non-null values for TypeScript
    const authInstance = auth;
    const dbInstance = db;

    const handleEmailLinkSignIn = async () => {
      if (isSignInWithEmailLink(authInstance, window.location.href)) {
        let email = window.localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY);
        const enableNotifications = window.localStorage.getItem(NOTIFICATIONS_PREF_KEY) === "true";

        if (!email) {
          // User opened the link on a different device
          email = window.prompt("Please provide your email for confirmation");
        }

        if (email) {
          try {
            setState((prev) => ({ ...prev, loading: true }));
            const result = await signInWithEmailLink(authInstance, email, window.location.href);
            const user = result.user;

            // Create or update user document
            const userRef = doc(dbInstance, "users", user.uid);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
              await setDoc(userRef, {
                email: user.email,
                displayName: user.email?.split("@")[0] || "User",
                photoURL: null,
                createdAt: serverTimestamp(),
                lastSeenAt: serverTimestamp(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                irlCity: getDefaultCity(),
                emailNotifications: {
                  showStarting: enableNotifications,
                  watchlistMatch: enableNotifications,
                },
              });

              // Reconcile any pending broadcast slots or tips by email
              // (e.g., DJ was approved before creating account)
              if (user.email) {
                try {
                  await fetch('/api/users/reconcile-broadcast-slots', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: user.uid, email: user.email }),
                  });
                } catch (err) {
                  console.error('Failed to reconcile broadcast slots (non-fatal):', err);
                }
              }
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

            // Check if DJ terms were accepted before sending the magic link
            const djTermsAccepted = window.localStorage.getItem('djTermsAccepted') === 'true';
            if (djTermsAccepted && user.email) {
              try {
                await fetch('/api/users/assign-dj-role', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: user.email }),
                });
              } catch (err) {
                console.error('Failed to assign DJ role (non-fatal):', err);
              }
            }

            // Clear stored email and preferences
            window.localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY);
            window.localStorage.removeItem(NOTIFICATIONS_PREF_KEY);
            window.localStorage.removeItem('djTermsAccepted');

            // Clean up URL
            window.history.replaceState(null, "", window.location.pathname);

            setState({ user, loading: false, error: null, emailSent: false, passwordResetSent: false });
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
      setState({ user: null, loading: false, error: null, emailSent: false, passwordResetSent: false });
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

  const signInWithGoogle = useCallback(async (enableNotifications = false, djUsername?: string) => {
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
        // New user - create document with notification preference and DJ username if provided
        await setDoc(userRef, {
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          irlCity: getDefaultCity(),
          emailNotifications: {
            showStarting: enableNotifications,
            watchlistMatch: enableNotifications,
          },
          // Set chatUsername from DJ broadcast flow if provided (matches iOS app field name)
          ...(djUsername && { chatUsername: djUsername }),
        });

        // Reconcile any pending broadcast slots or tips by email
        // (e.g., DJ was approved before creating account)
        if (user.email) {
          try {
            await fetch('/api/users/reconcile-broadcast-slots', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: user.uid, email: user.email }),
            });
          } catch (err) {
            console.error('Failed to reconcile broadcast slots (non-fatal):', err);
          }
        }
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
        // Set chatUsername if provided and user doesn't already have one
        const existingData = userSnap.data();
        if (djUsername && !existingData.chatUsername) {
          updateData.chatUsername = djUsername;
        }
        await setDoc(userRef, updateData, { merge: true });
      }

      // Register username in usernames collection for cross-platform uniqueness
      if (djUsername) {
        try {
          const idToken = await user.getIdToken();
          await fetch('/api/chat/register-username', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({ username: djUsername }),
          });
        } catch (err) {
          console.error('Failed to register username (non-fatal):', err);
        }
      }

      setState({ user, loading: false, error: null, emailSent: false, passwordResetSent: false });
      return user;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sign in";
      console.error("Sign in error:", error);
      setState((prev) => ({ ...prev, loading: false, error: message }));
      return null;
    }
  }, []);

  const signInWithApple = useCallback(async (enableNotifications = false, djUsername?: string) => {
    if (!auth || !appleProvider || !db) {
      setState((prev) => ({
        ...prev,
        error: "Authentication not configured",
      }));
      return null;
    }

    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const result = await signInWithPopup(auth, appleProvider);
      const user = result.user;

      // Create or update user document in Firestore
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        // New user - create document with notification preference and DJ username if provided
        await setDoc(userRef, {
          email: user.email,
          displayName: user.displayName || user.email?.split("@")[0] || "User",
          photoURL: user.photoURL,
          createdAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          irlCity: getDefaultCity(),
          emailNotifications: {
            showStarting: enableNotifications,
            watchlistMatch: enableNotifications,
          },
          // Set chatUsername from DJ broadcast flow if provided (matches iOS app field name)
          ...(djUsername && { chatUsername: djUsername }),
        });

        // Reconcile any pending broadcast slots or tips by email
        // (e.g., DJ was approved before creating account)
        if (user.email) {
          try {
            await fetch('/api/users/reconcile-broadcast-slots', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: user.uid, email: user.email }),
            });
          } catch (err) {
            console.error('Failed to reconcile broadcast slots (non-fatal):', err);
          }
        }
      } else {
        // Existing user - update last seen
        const updateData: Record<string, unknown> = {
          lastSeenAt: serverTimestamp(),
        };
        if (enableNotifications) {
          updateData.emailNotifications = {
            showStarting: true,
            watchlistMatch: true,
          };
        }
        // Set chatUsername if provided and user doesn't already have one
        const existingData = userSnap.data();
        if (djUsername && !existingData.chatUsername) {
          updateData.chatUsername = djUsername;
        }
        await setDoc(userRef, updateData, { merge: true });
      }

      // Register username in usernames collection for cross-platform uniqueness
      if (djUsername) {
        try {
          const idToken = await user.getIdToken();
          await fetch('/api/chat/register-username', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({ username: djUsername }),
          });
        } catch (err) {
          console.error('Failed to register username (non-fatal):', err);
        }
      }

      setState({ user, loading: false, error: null, emailSent: false, passwordResetSent: false });
      return user;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sign in with Apple";
      console.error("Apple sign in error:", error);
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
      url: window.location.origin + "/channel",
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

  const resetPasswordResetSent = useCallback(() => {
    setState((prev) => ({ ...prev, passwordResetSent: false, error: null }));
  }, []);

  // Check what sign-in methods exist for an email
  const checkEmailMethods = useCallback(async (email: string): Promise<string[]> => {
    if (!auth) return [];
    try {
      return await fetchSignInMethodsForEmail(auth, email);
    } catch (error) {
      console.error("Error checking email methods:", error);
      return [];
    }
  }, []);

  // Sign in with email and password
  const signInWithPassword = useCallback(async (
    email: string,
    password: string,
    enableNotifications = false
  ): Promise<User | null> => {
    if (!auth || !db) {
      setState((prev) => ({ ...prev, error: "Authentication not configured" }));
      return null;
    }

    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const result = await signInWithEmailAndPassword(auth, email, password);
      const user = result.user;

      // Update user document
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      const updateData: Record<string, unknown> = {
        lastSeenAt: serverTimestamp(),
      };
      if (enableNotifications) {
        updateData.emailNotifications = {
          showStarting: true,
          watchlistMatch: true,
        };
      }

      if (!userSnap.exists()) {
        // First time signing in with password - create user doc
        await setDoc(userRef, {
          email: user.email,
          displayName: user.email?.split("@")[0] || "User",
          photoURL: null,
          createdAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          irlCity: getDefaultCity(),
          emailNotifications: {
            showStarting: enableNotifications,
            watchlistMatch: enableNotifications,
          },
        });
      } else {
        await setDoc(userRef, updateData, { merge: true });
      }

      setState({ user, loading: false, error: null, emailSent: false, passwordResetSent: false });
      return user;
    } catch (error) {
      const firebaseError = error as { code?: string };
      let message = "Failed to sign in";

      if (firebaseError.code === "auth/wrong-password" || firebaseError.code === "auth/invalid-credential") {
        message = "Incorrect password";
      } else if (firebaseError.code === "auth/user-not-found") {
        message = "No account found with this email";
      } else if (firebaseError.code === "auth/too-many-requests") {
        message = "Too many attempts. Please try again later.";
      } else if (firebaseError.code === "auth/invalid-email") {
        message = "Invalid email address";
      }

      console.error("Password sign-in error:", error);
      setState((prev) => ({ ...prev, loading: false, error: message }));
      return null;
    }
  }, []);

  // Create account with email and password
  const createAccountWithPassword = useCallback(async (
    email: string,
    password: string,
    enableNotifications = false
  ): Promise<User | null> => {
    if (!auth || !db) {
      setState((prev) => ({ ...prev, error: "Authentication not configured" }));
      return null;
    }

    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const result = await createUserWithEmailAndPassword(auth, email, password);
      const user = result.user;

      // Create user document
      const userRef = doc(db, "users", user.uid);
      await setDoc(userRef, {
        email: user.email,
        displayName: user.email?.split("@")[0] || "User",
        photoURL: null,
        createdAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        irlCity: getDefaultCity(),
        emailNotifications: {
          showStarting: enableNotifications,
          watchlistMatch: enableNotifications,
        },
      });

      // Reconcile any pending broadcast slots or tips by email
      // (e.g., DJ was approved before creating account)
      if (user.email) {
        try {
          await fetch('/api/users/reconcile-broadcast-slots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.uid, email: user.email }),
          });
        } catch (err) {
          console.error('Failed to reconcile broadcast slots (non-fatal):', err);
        }
      }

      setState({ user, loading: false, error: null, emailSent: false, passwordResetSent: false });
      return user;
    } catch (error) {
      const firebaseError = error as { code?: string };
      let message = "Failed to create account";

      if (firebaseError.code === "auth/email-already-in-use") {
        message = "An account already exists with this email";
      } else if (firebaseError.code === "auth/weak-password") {
        message = "Password must be at least 6 characters";
      } else if (firebaseError.code === "auth/invalid-email") {
        message = "Invalid email address";
      }

      console.error("Account creation error:", error);
      setState((prev) => ({ ...prev, loading: false, error: message }));
      return null;
    }
  }, []);

  // Send password reset email
  const sendPasswordReset = useCallback(async (email: string): Promise<boolean> => {
    if (!auth) {
      setState((prev) => ({ ...prev, error: "Authentication not configured" }));
      return false;
    }

    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      await sendPasswordResetEmail(auth, email);
      setState((prev) => ({ ...prev, loading: false, passwordResetSent: true }));
      return true;
    } catch (error) {
      const firebaseError = error as { code?: string };
      let message = "Failed to send password reset email";

      if (firebaseError.code === "auth/user-not-found") {
        // Don't reveal if email exists for security
        message = "If this email is registered, you'll receive a reset link.";
        setState((prev) => ({ ...prev, loading: false, passwordResetSent: true }));
        return true;
      } else if (firebaseError.code === "auth/invalid-email") {
        message = "Invalid email address";
      }

      console.error("Password reset error:", error);
      setState((prev) => ({ ...prev, loading: false, error: message }));
      return false;
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!auth) return;

    try {
      await firebaseSignOut(auth);
      setState({ user: null, loading: false, error: null, emailSent: false, passwordResetSent: false });
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
    passwordResetSent: state.passwordResetSent,
    signInWithGoogle,
    signInWithApple,
    sendEmailLink,
    resetEmailSent,
    checkEmailMethods,
    signInWithPassword,
    createAccountWithPassword,
    sendPasswordReset,
    resetPasswordResetSent,
    signOut,
    isAuthenticated: !!state.user,
  };
}
