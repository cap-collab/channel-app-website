"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuthContext } from "@/contexts/AuthContext";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  message?: string;
}

export function AuthModal({
  isOpen,
  onClose,
  message = "Sign in to save favorites and get alerts",
}: AuthModalProps) {
  const { sendEmailLink, loading, error, emailSent, resetEmailSent } = useAuthContext();
  const [email, setEmail] = useState("");
  const [enableNotifications, setEnableNotifications] = useState(true);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setEmail("");
      resetEmailSent();
    }
  }, [isOpen, resetEmailSent]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    await sendEmailLink(email.trim(), enableNotifications);
  };

  // Email sent success view
  if (emailSent) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90"
        onClick={onClose}
      >
        <div
          className="bg-black border border-gray-800 rounded-xl p-6 max-w-sm w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>

          <h2 className="text-xl font-bold text-white mb-2 text-center">Check your email</h2>
          <p className="text-gray-400 text-sm text-center mb-6">
            We sent a sign-in link to <span className="text-white">{email}</span>. Click the link to sign in.
          </p>

          <button
            onClick={onClose}
            className="w-full py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-100 transition-colors"
          >
            Done
          </button>

          <button
            onClick={() => resetEmailSent()}
            className="w-full mt-3 py-2 text-gray-500 text-sm hover:text-white transition-colors"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90"
      onClick={onClose}
    >
      <div
        className="bg-black border border-gray-800 rounded-xl p-6 max-w-sm w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-white mb-2">Sign In</h2>
        <p className="text-gray-500 text-sm mb-6">{message}</p>

        {error && (
          <div className="mb-4 p-3 bg-red-900/20 border border-red-900 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Email input */}
          <div className="mb-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
              className="w-full px-4 py-3 bg-transparent border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors"
            />
          </div>

          {/* Email notifications opt-in */}
          <label className="flex items-start gap-3 mb-6 cursor-pointer group">
            <div className="relative flex-shrink-0 mt-0.5">
              <input
                type="checkbox"
                checked={enableNotifications}
                onChange={(e) => setEnableNotifications(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-5 h-5 border border-gray-600 rounded bg-transparent peer-checked:bg-white peer-checked:border-white transition-colors" />
              <svg
                className="absolute top-0.5 left-0.5 w-4 h-4 text-black opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
              Email me when my favorite DJs or shows are scheduled
            </span>
          </label>

          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="w-full flex items-center justify-center gap-3 bg-white text-black py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-gray-400 border-t-black rounded-full animate-spin" />
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Continue with Email
              </>
            )}
          </button>
        </form>

        <p className="mt-4 text-xs text-gray-500 text-center">
          By signing in, you agree to our{" "}
          <Link href="/terms" className="text-gray-400 hover:text-white underline">
            Terms of Use
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-gray-400 hover:text-white underline">
            Privacy Policy
          </Link>
        </p>

        <button
          onClick={onClose}
          className="w-full mt-3 py-2 text-gray-500 text-sm hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
