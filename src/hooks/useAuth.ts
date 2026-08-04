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
import { normalizeUsername } from "@/lib/dj-matching";
import { captureAnon, mergeAnonHistory } from "@/lib/merge-anon-history";

const EMAIL_FOR_SIGN_IN_KEY = "emailForSignIn";
const NOTIFICATIONS_PREF_KEY = "notificationsPref";
// Magic-link completes in a fresh tab where the anon session is no longer
// currentUser, so stash the anon identity here to merge after sign-in. Skipped
// silently if absent (cross-browser Android links) — never blocks sign-in.
const MERGE_ANON_UID_KEY = "mergeAnonUid";
const MERGE_ANON_TOKEN_KEY = "mergeAnonIdToken";

// chatUsername and chatUsernameNormalized must always be written together —
// /dj/<username> looks up by chatUsernameNormalized, so a user with one but not
// the other is unreachable. Uses the shared canonical normalizeUsername (strips
// ALL non-alphanumerics incl dots) — the SAME rule page.tsx / register-username
// resolve with, so a dotted name like "B. Rod" stores + resolves as "brod".
function chatUsernameFields(name: string) {
  return {
    chatUsername: name,
    chatUsernameNormalized: normalizeUsername(name),
  };
}

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
        console.log('[email-link] Detected email sign-in link');
        console.log('[email-link] localStorage keys:', {
          email: window.localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY),
          djTermsAccepted: window.localStorage.getItem('djTermsAccepted'),
          authRedirectTo: window.localStorage.getItem('authRedirectTo'),
        });
        let email = window.localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY)?.trim() || null;
        const enableNotifications = window.localStorage.getItem(NOTIFICATIONS_PREF_KEY) === "true";

        // On Android the link very often opens in a different browser/WebView
        // (e.g. Gmail's in-app browser) than the one that requested it, so the
        // stored email isn't present. Ask for it, and re-ask on a typo — the
        // link is only consumed by a *successful* signInWithEmailLink, so a bad
        // email throws without burning it.
        if (!email) {
          email = window.prompt("Confirm the email address you signed in with")?.trim().toLowerCase() || null;
        }

        if (email) {
          try {
            setState((prev) => ({ ...prev, loading: true }));
            let result;
            for (;;) {
              try {
                result = await signInWithEmailLink(authInstance, email, window.location.href);
                break;
              } catch (linkError) {
                const code = (linkError as { code?: string }).code;
                // A mistyped email rejects with invalid-email; the action code
                // itself is still valid, so re-prompt rather than dead-ending.
                if (code === "auth/invalid-email") {
                  const retry = window.prompt("That email didn't match. Re-enter the exact email you used")?.trim().toLowerCase();
                  if (retry) {
                    email = retry;
                    continue;
                  }
                }
                throw linkError;
              }
            }
            const user = result.user;

            // Create or update user document
            const userRef = doc(dbInstance, "users", user.uid);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
              // merge:true — the exists() check is a CLIENT read and can return a
              // false negative right after an auth swap (stale anon-session cache
              // / rules evaluated on the outgoing token). A bare setDoc would then
              // REPLACE a real account, dropping djProfile, recordingQuota,
              // chatUsername &c. Merging is identical for a genuinely new doc and
              // harmless when the check was wrong.
              await setDoc(userRef, {
                email: user.email,
                displayName: user.email?.split("@")[0] || "User",
                photoURL: null,
                createdAt: serverTimestamp(),
                lastSeenAt: serverTimestamp(),
                signInMethod: "emailLink",
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                irlCity: getDefaultCity(),
                emailNotifications: {
                  showStarting: enableNotifications,
                  watchlistMatch: enableNotifications,
                  engagementGoLive: true,
                  weeklyRecommendations: true,
                },
              }, { merge: true });

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
                signInMethod: "emailLink",
              };
              if (enableNotifications) {
                updateData.emailNotifications = {
                  showStarting: true,
                  watchlistMatch: true,
                  engagementGoLive: true,
                };
              }
              await setDoc(userRef, updateData, { merge: true });
            }

            // Check if DJ terms were accepted before sending the magic link
            const djTermsAccepted = window.localStorage.getItem('djTermsAccepted') === 'true';
            console.log('[email-link] Sign-in successful, djTermsAccepted:', djTermsAccepted, 'email:', user.email);
            if (djTermsAccepted && user.email) {
              try {
                console.log('[email-link] Calling assign-dj-role...');
                const resp = await fetch('/api/users/assign-dj-role', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: user.email }),
                });
                console.log('[email-link] assign-dj-role response:', resp.status);
              } catch (err) {
                console.error('Failed to assign DJ role (non-fatal):', err);
              }
            }

            // Fold any anonymous history stashed by sendEmailLink into this
            // account (same-browser links only; absent → skipped). Non-fatal.
            const mergeAnonUid = window.localStorage.getItem(MERGE_ANON_UID_KEY);
            const mergeAnonToken = window.localStorage.getItem(MERGE_ANON_TOKEN_KEY);
            if (mergeAnonUid && mergeAnonToken) {
              void mergeAnonHistory({ uid: mergeAnonUid, idToken: mergeAnonToken }, user);
            }
            window.localStorage.removeItem(MERGE_ANON_UID_KEY);
            window.localStorage.removeItem(MERGE_ANON_TOKEN_KEY);

            // Clear stored email and preferences
            window.localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY);
            window.localStorage.removeItem(NOTIFICATIONS_PREF_KEY);
            window.localStorage.removeItem('djTermsAccepted');

            // Redirect if a target was stored, otherwise clean up URL
            const authRedirectTo = window.localStorage.getItem('authRedirectTo');
            console.log('[email-link] authRedirectTo:', authRedirectTo);
            window.localStorage.removeItem('authRedirectTo');
            if (authRedirectTo) {
              window.location.href = authRedirectTo;
              return;
            }

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

    // Safety net: in some environments (email in-app browsers, private mode)
    // Firebase persistence is blocked and onAuthStateChanged can NEVER fire,
    // leaving `loading: true` forever — which deadlocks any UI gated on auth.
    // After a short grace period, force-resolve as logged-out so the app always
    // proceeds. The real callback (below) clears this and wins if it does fire.
    const fallback = setTimeout(() => {
      setState((prev) => (prev.loading ? { ...prev, loading: false } : prev));
    }, 3500);

    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        clearTimeout(fallback);
        setState((prev) => ({ ...prev, user, loading: false, error: null }));
      },
      (error) => {
        clearTimeout(fallback);
        console.error("Auth state change error:", error);
        setState((prev) => ({ ...prev, user: null, loading: false, error: error.message }));
      }
    );

    return () => {
      clearTimeout(fallback);
      unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async (enableNotifications = false, djUsername?: string) => {
    if (!auth || !googleProvider || !db) {
      setState((prev) => ({
        ...prev,
        error: "Authentication not configured",
      }));
      return null;
    }

    // Capture the anon session (if any) BEFORE sign-in replaces currentUser, so
    // its history can be merged into the account below. Non-fatal.
    const anon = await captureAnon();
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      // Create or update user document in Firestore
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        // New user - create document with notification preference and DJ username if provided
        // merge:true — see the emailLink path: a false-negative exists() must not
        // replace an existing account.
        await setDoc(userRef, {
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
          signInMethod: "google",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          irlCity: getDefaultCity(),
          emailNotifications: {
            showStarting: enableNotifications,
            watchlistMatch: enableNotifications,
            engagementGoLive: true,
            weeklyRecommendations: true,
          },
          // Set chatUsername from DJ broadcast flow if provided (matches iOS app field name)
          ...(djUsername && chatUsernameFields(djUsername)),
        }, { merge: true });

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
          signInMethod: "google",
        };
        if (enableNotifications) {
          updateData.emailNotifications = {
            showStarting: true,
            watchlistMatch: true,
            engagementGoLive: true,
          };
        }
        // Set chatUsername if provided and user doesn't already have one
        const existingData = userSnap.data();
        if (djUsername && !existingData.chatUsername) {
          Object.assign(updateData, chatUsernameFields(djUsername));
        }
        // Self-heal email-less docs: a doc created by the (old) LastSeenStamp
        // race, or any past path, may lack `email` — which makes the account
        // invisible to every email-keyed lookup (assign-dj-role,
        // reconcile-broadcast-slots) and traps the user on "Activate Artist
        // Profile". Backfill it (and displayName/photoURL) when missing, without
        // clobbering existing good data. Idempotent no-op for healthy docs.
        if (!existingData.email && user.email) updateData.email = user.email;
        if (!existingData.displayName && user.displayName) updateData.displayName = user.displayName;
        if (!existingData.photoURL && user.photoURL) updateData.photoURL = user.photoURL;
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

      // Fold any anonymous history into this account (non-fatal, no-op if none).
      void mergeAnonHistory(anon, user);

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

    const anon = await captureAnon();
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
          signInMethod: "apple",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          irlCity: getDefaultCity(),
          emailNotifications: {
            showStarting: enableNotifications,
            watchlistMatch: enableNotifications,
            engagementGoLive: true,
            weeklyRecommendations: true,
          },
          // Set chatUsername from DJ broadcast flow if provided (matches iOS app field name)
          ...(djUsername && chatUsernameFields(djUsername)),
        }, { merge: true });

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
          signInMethod: "apple",
        };
        if (enableNotifications) {
          updateData.emailNotifications = {
            showStarting: true,
            watchlistMatch: true,
            engagementGoLive: true,
          };
        }
        // Set chatUsername if provided and user doesn't already have one
        const existingData = userSnap.data();
        if (djUsername && !existingData.chatUsername) {
          Object.assign(updateData, chatUsernameFields(djUsername));
        }
        // Self-heal email-less docs: a doc created by the (old) LastSeenStamp
        // race, or any past path, may lack `email` — which makes the account
        // invisible to every email-keyed lookup (assign-dj-role,
        // reconcile-broadcast-slots) and traps the user on "Activate Artist
        // Profile". Backfill it (and displayName/photoURL) when missing, without
        // clobbering existing good data. Idempotent no-op for healthy docs.
        if (!existingData.email && user.email) updateData.email = user.email;
        if (!existingData.displayName && user.displayName) updateData.displayName = user.displayName;
        if (!existingData.photoURL && user.photoURL) updateData.photoURL = user.photoURL;
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

      // Fold any anonymous history into this account (non-fatal, no-op if none).
      void mergeAnonHistory(anon, user);

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
      url: window.location.origin + "/",
      handleCodeInApp: true,
    };

    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      await sendSignInLinkToEmail(auth, email, actionCodeSettings);

      // Store email and notification preference for after sign-in
      window.localStorage.setItem(EMAIL_FOR_SIGN_IN_KEY, email);
      window.localStorage.setItem(NOTIFICATIONS_PREF_KEY, enableNotifications.toString());

      // Stash the current anon identity so its history can be merged when the
      // link is completed (same browser). captureAnon returns null if not anon.
      const anon = await captureAnon();
      if (anon) {
        window.localStorage.setItem(MERGE_ANON_UID_KEY, anon.uid);
        window.localStorage.setItem(MERGE_ANON_TOKEN_KEY, anon.idToken);
      }

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

    const anon = await captureAnon();
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const result = await signInWithEmailAndPassword(auth, email, password);
      const user = result.user;

      // Update user document
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      const updateData: Record<string, unknown> = {
        lastSeenAt: serverTimestamp(),
        signInMethod: "password",
      };
      if (enableNotifications) {
        updateData.emailNotifications = {
          showStarting: true,
          watchlistMatch: true,
          engagementGoLive: true,
        };
      }

      if (!userSnap.exists()) {
        // First time signing in with password - create user doc
        // merge:true — a false-negative exists() must not replace a real account.
        await setDoc(userRef, {
          email: user.email,
          displayName: user.email?.split("@")[0] || "User",
          photoURL: null,
          createdAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
          signInMethod: "password",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          irlCity: getDefaultCity(),
          emailNotifications: {
            showStarting: enableNotifications,
            watchlistMatch: enableNotifications,
            engagementGoLive: true,
            weeklyRecommendations: true,
          },
        }, { merge: true });
      } else {
        await setDoc(userRef, updateData, { merge: true });
      }

      // Fold any anonymous history into this account (non-fatal, no-op if none).
      void mergeAnonHistory(anon, user);

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

    const anon = await captureAnon();
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
        signInMethod: "password",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        irlCity: getDefaultCity(),
        emailNotifications: {
          showStarting: enableNotifications,
          watchlistMatch: enableNotifications,
          engagementGoLive: true,
          weeklyRecommendations: true,
        },
      }, { merge: true });

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

      // Fold any anonymous history into this brand-new account (non-fatal).
      void mergeAnonHistory(anon, user);

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

  // Try to create account; if email is already in use, fall back to sign-in.
  // This avoids relying on fetchSignInMethodsForEmail which returns [] with email enumeration protection.
  const signInOrCreateWithPassword = useCallback(async (
    email: string,
    password: string,
    enableNotifications = false
  ): Promise<User | null> => {
    if (!auth || !db) {
      setState((prev) => ({ ...prev, error: "Authentication not configured" }));
      return null;
    }

    const anon = await captureAnon();
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      // Try creating a new account first
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
        signInMethod: "password",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        irlCity: getDefaultCity(),
        emailNotifications: {
          showStarting: enableNotifications,
          watchlistMatch: enableNotifications,
          engagementGoLive: true,
          weeklyRecommendations: true,
        },
      }, { merge: true });

      // Reconcile any pending broadcast slots or tips by email
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

      // Fold any anonymous history into this brand-new account (non-fatal).
      void mergeAnonHistory(anon, user);

      setState({ user, loading: false, error: null, emailSent: false, passwordResetSent: false });
      return user;
    } catch (createError) {
      const firebaseCreateError = createError as { code?: string; message?: string };
      console.error("[signInOrCreate] Create failed:", firebaseCreateError.code, firebaseCreateError.message);

      if (firebaseCreateError.code === "auth/email-already-in-use") {
        // Account exists — try signing in instead
        try {
          const result = await signInWithEmailAndPassword(auth, email, password);
          const user = result.user;

          // Update user document
          const userRef = doc(db, "users", user.uid);
          const userSnap = await getDoc(userRef);
          const updateData: Record<string, unknown> = {
            lastSeenAt: serverTimestamp(),
            signInMethod: "password",
          };
          if (enableNotifications) {
            updateData.emailNotifications = {
              showStarting: true,
              watchlistMatch: true,
              engagementGoLive: true,
            };
          }
          // Self-heal: backfill email onto an existing doc that lacks it (e.g. a
          // phantom created by the old LastSeenStamp race), so email-keyed
          // lookups can find the account. No-op for healthy docs.
          if (userSnap.exists() && !userSnap.data()?.email && user.email) {
            updateData.email = user.email;
          }
          if (!userSnap.exists()) {
            // merge:true — a false-negative exists() must not replace a real account.
            await setDoc(userRef, {
              email: user.email,
              displayName: user.email?.split("@")[0] || "User",
              photoURL: null,
              createdAt: serverTimestamp(),
              ...updateData,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              irlCity: getDefaultCity(),
            }, { merge: true });
          } else {
            await setDoc(userRef, updateData, { merge: true });
          }

          // Existing account: fold the anon history in via server merge (the anon
          // uid can't be kept here). Non-fatal — never blocks this sign-in.
          void mergeAnonHistory(anon, user);

          setState({ user, loading: false, error: null, emailSent: false, passwordResetSent: false });
          return user;
        } catch (signInError) {
          const firebaseSignInError = signInError as { code?: string };
          let message = "Failed to sign in";

          if (firebaseSignInError.code === "auth/wrong-password" || firebaseSignInError.code === "auth/invalid-credential") {
            message = "An account exists with this email but uses a different sign-in method. Try signing in with Google, Apple, or a magic link instead.";
          } else if (firebaseSignInError.code === "auth/too-many-requests") {
            message = "Too many attempts. Please try again later.";
          }

          console.error("Password sign-in error:", signInError);
          setState((prev) => ({ ...prev, loading: false, error: message }));
          return null;
        }
      }

      // Other create errors (weak password, invalid email, etc.)
      let message = "Failed to create account";
      if (firebaseCreateError.code === "auth/weak-password") {
        message = "Password must be at least 6 characters";
      } else if (firebaseCreateError.code === "auth/invalid-email") {
        message = "Invalid email address";
      }

      console.error("Account creation error:", createError);
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
    signInOrCreateWithPassword,
    sendPasswordReset,
    resetPasswordResetSent,
    signOut,
    isAuthenticated: !!state.user && !state.user.isAnonymous,
  };
}
