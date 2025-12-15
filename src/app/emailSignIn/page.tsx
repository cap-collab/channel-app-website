"use client";

import { useEffect, useState, useCallback } from "react";
import { isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

const EMAIL_FOR_SIGN_IN_KEY = "emailForSignIn";

// Detect if user is on iOS
function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export default function EmailSignInPage() {
  const [status, setStatus] = useState<"loading" | "email-needed" | "success" | "error">("loading");
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [showOpenAppButton, setShowOpenAppButton] = useState(false);

  // Try to open the app on iOS
  useEffect(() => {
    if (isIOS()) {
      // Try to open the app with the current URL
      const currentUrl = window.location.href;
      // Use the channel:// custom scheme with the full URL as a parameter
      const appUrl = `channel://emailSignIn?url=${encodeURIComponent(currentUrl)}`;

      // Try to open the app
      window.location.href = appUrl;

      // If we're still here after 2 seconds, show the manual button and continue with web sign-in
      setTimeout(() => {
        setShowOpenAppButton(true);
      }, 2000);
    }
  }, []);

  const completeSignIn = useCallback(async (userEmail: string) => {
    if (!auth || !db) return;

    try {
      setStatus("loading");
      const result = await signInWithEmailLink(auth, userEmail, window.location.href);
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
            showStarting: true,
            watchlistMatch: true,
          },
        });
      } else {
        await setDoc(userRef, { lastSeenAt: serverTimestamp() }, { merge: true });
      }

      // Clear stored email
      window.localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY);

      setStatus("success");

      // Redirect to djshows after short delay
      setTimeout(() => {
        window.location.href = "/djshows";
      }, 1500);
    } catch (error) {
      console.error("Email link sign-in error:", error);
      setErrorMessage("Failed to sign in. The link may have expired. Please try again.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const handleEmailSignIn = async () => {
      if (!auth || !db) {
        setErrorMessage("Authentication not configured");
        setStatus("error");
        return;
      }

      const fullUrl = window.location.href;

      // Check if this is a valid email sign-in link
      if (!isSignInWithEmailLink(auth, fullUrl)) {
        setErrorMessage("Invalid sign-in link");
        setStatus("error");
        return;
      }

      // Try to get email from localStorage (same device sign-in)
      const storedEmail = window.localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY);

      if (!storedEmail) {
        // User is on a different device - need to ask for email
        setStatus("email-needed");
        return;
      }

      await completeSignIn(storedEmail);
    };

    handleEmailSignIn();
  }, [completeSignIn]);

  const handleSubmitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      completeSignIn(email.trim());
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        {status === "loading" && (
          <div className="space-y-4">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white mx-auto"></div>
            <p className="text-white text-lg">Signing you in...</p>
            {showOpenAppButton && (
              <button
                onClick={() => {
                  const currentUrl = window.location.href;
                  window.location.href = `channel://emailSignIn?url=${encodeURIComponent(currentUrl)}`;
                }}
                className="mt-4 px-6 py-3 rounded-lg bg-blue-600 text-white font-semibold"
              >
                Open in Channel App
              </button>
            )}
          </div>
        )}

        {status === "email-needed" && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-white">Confirm Your Email</h1>
            <p className="text-gray-400">
              Please enter the email address you used to sign in.
            </p>
            <form onSubmit={handleSubmitEmail} className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                autoFocus
              />
              <button
                type="submit"
                disabled={!email.trim()}
                className="w-full py-3 rounded-lg bg-white text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </form>
          </div>
        )}

        {status === "success" && (
          <div className="space-y-4">
            <div className="text-green-500 text-6xl">✓</div>
            <h1 className="text-2xl font-bold text-white">You&apos;re signed in!</h1>
            <p className="text-gray-400">Redirecting you to DJ Shows...</p>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-4">
            <div className="text-red-500 text-6xl">✕</div>
            <h1 className="text-2xl font-bold text-white">Sign In Failed</h1>
            <p className="text-gray-400">{errorMessage}</p>
            {/* Go to DJ Shows button hidden */}
            {false && (
              <a
                href="/djshows"
                className="inline-block mt-4 px-6 py-3 rounded-lg bg-white text-black font-semibold"
              >
                Go to DJ Shows
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
