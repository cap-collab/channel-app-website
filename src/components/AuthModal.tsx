"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuthContext } from "@/contexts/AuthContext";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  message?: string;
  /** Render inline (not as a modal overlay) */
  inline?: boolean;
}

type ModalView = "main" | "emailInput" | "methodChoice" | "password" | "forgotPassword";

export function AuthModal({
  isOpen,
  onClose,
  message = "Sign in to save favorites and get alerts",
  inline = false,
}: AuthModalProps) {
  const {
    sendEmailLink,
    signInWithGoogle,
    signInWithApple,
    signInWithPassword,
    createAccountWithPassword,
    sendPasswordReset,
    checkEmailMethods,
    loading,
    error,
    emailSent,
    passwordResetSent,
    resetEmailSent,
    resetPasswordResetSent,
  } = useAuthContext();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [enableNotifications, setEnableNotifications] = useState(true);
  const [view, setView] = useState<ModalView>("main");
  const [isNewUser, setIsNewUser] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setView("main");
      setIsNewUser(false);
      setForgotPasswordEmail("");
      resetEmailSent();
      resetPasswordResetSent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleGoogleSignIn = async () => {
    const user = await signInWithGoogle(enableNotifications);
    if (user) {
      onClose();
    }
  };

  const handleAppleSignIn = async () => {
    const user = await signInWithApple(enableNotifications);
    if (user) {
      onClose();
    }
  };

  const handleEmailContinue = async () => {
    if (!email.trim()) return;
    // Check if user exists to determine if they're new
    const methods = await checkEmailMethods(email.trim());
    setIsNewUser(methods.length === 0);
    setView("methodChoice");
  };

  const handleSendMagicLink = async () => {
    if (!email.trim()) return;
    await sendEmailLink(email.trim(), enableNotifications);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    if (isNewUser) {
      if (password !== confirmPassword) {
        return;
      }
      const user = await createAccountWithPassword(email.trim(), password, enableNotifications);
      if (user) {
        onClose();
      }
    } else {
      const user = await signInWithPassword(email.trim(), password, enableNotifications);
      if (user) {
        onClose();
      }
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailToReset = forgotPasswordEmail.trim() || email.trim();
    if (!emailToReset) return;
    await sendPasswordReset(emailToReset);
  };

  const goBack = () => {
    if (view === "password" || view === "methodChoice") {
      setView("emailInput");
      setPassword("");
      setConfirmPassword("");
    } else if (view === "emailInput" || view === "forgotPassword") {
      setView("main");
      setEmail("");
      setForgotPasswordEmail("");
    }
  };

  if (!isOpen) return null;

  // Wrapper component for modal vs inline rendering
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    if (inline) {
      return <div className="w-full">{children}</div>;
    }
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="bg-white/[0.08] backdrop-blur-xl rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-white/[0.1]"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    );
  };

  // Password reset sent success view
  if (passwordResetSent) {
    return (
      <Wrapper>
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>

          <h2 className="text-xl font-bold text-white mb-2 text-center">Check your email</h2>
          <p className="text-white/60 text-sm text-center mb-6">
            We sent a password reset link to <span className="text-white">{forgotPasswordEmail || email}</span>.
          </p>

          <button
            onClick={onClose}
            className="w-full py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-all"
          >
            Done
          </button>

          <button
            onClick={() => {
              resetPasswordResetSent();
              setView("forgotPassword");
            }}
            className="w-full mt-3 py-2 text-white/50 text-sm hover:text-white transition-colors"
          >
            Try a different email
          </button>
      </Wrapper>
    );
  }

  // Email sent success view
  if (emailSent) {
    return (
      <Wrapper>
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>

          <h2 className="text-xl font-bold text-white mb-2 text-center">Check your email</h2>
          <p className="text-white/60 text-sm text-center mb-6">
            We sent a sign-in link to <span className="text-white">{email}</span>. Click the link to sign in.
          </p>

          <button
            onClick={onClose}
            className="w-full py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-all"
          >
            Done
          </button>

          <button
            onClick={() => resetEmailSent()}
            className="w-full mt-3 py-2 text-white/50 text-sm hover:text-white transition-colors"
          >
            Use a different email
          </button>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
        {/* Header */}
        <h2 className="text-xl font-bold text-white mb-2">
          {view === "forgotPassword" ? "Reset Password" : "Sign In"}
        </h2>
        {view === "main" && <p className="text-white/50 text-sm mb-6">{message}</p>}

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Main sign-in options */}
        {view === "main" && (
          <div className="space-y-3">
            {/* Apple Sign In */}
            <button
              onClick={handleAppleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white text-black py-3 rounded-xl font-medium hover:bg-white/90 transition-all disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-gray-400 border-t-black rounded-full animate-spin" />
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                  </svg>
                  Continue with Apple
                </>
              )}
            </button>

            {/* Google Sign In */}
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white text-black py-3 rounded-xl font-medium hover:bg-white/90 transition-all disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-gray-400 border-t-black rounded-full animate-spin" />
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Continue with Google
                </>
              )}
            </button>

            {/* Email Sign In */}
            <button
              onClick={() => setView("emailInput")}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white/[0.08] text-white py-3 rounded-xl font-medium hover:bg-white/[0.15] transition-all disabled:opacity-50"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Continue with Email
            </button>

            {/* Forgot password link */}
            <button
              onClick={() => setView("forgotPassword")}
              className="w-full py-2 text-white/50 text-sm hover:text-white transition-colors"
            >
              Forgot password?
            </button>

            {/* Email notifications opt-in */}
            <label className="flex items-start gap-3 mt-4 cursor-pointer group">
              <div className="relative flex-shrink-0 mt-0.5">
                <input
                  type="checkbox"
                  checked={enableNotifications}
                  onChange={(e) => setEnableNotifications(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-5 h-5 border border-white/30 rounded bg-white/[0.05] peer-checked:bg-white peer-checked:border-white transition-all" />
                <svg
                  className="absolute top-0.5 left-0.5 w-4 h-4 text-black opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm text-white/60 group-hover:text-white/80 transition-colors">
                Email me when my favorite DJs or shows are scheduled
              </span>
            </label>
          </div>
        )}

        {/* Email input view */}
        {view === "emailInput" && (
          <div className="space-y-4">
            <div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                autoFocus
                className="w-full px-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-all"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && email.trim()) {
                    handleEmailContinue();
                  }
                }}
              />
            </div>

            <button
              onClick={handleEmailContinue}
              disabled={loading || !email.trim()}
              className="w-full py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-all disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-gray-400 border-t-black rounded-full animate-spin mx-auto" />
              ) : (
                "Continue"
              )}
            </button>

            <button
              onClick={goBack}
              className="w-full py-2 text-white/50 text-sm hover:text-white transition-colors"
            >
              Back to sign-in options
            </button>
          </div>
        )}

        {/* Method choice view */}
        {view === "methodChoice" && (
          <div className="space-y-4">
            <p className="text-white/60 text-sm mb-4">{email}</p>

            <button
              onClick={handleSendMagicLink}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white text-black py-3 rounded-xl font-medium hover:bg-white/90 transition-all disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-gray-400 border-t-black rounded-full animate-spin" />
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Send sign-in link
                </>
              )}
            </button>

            <button
              onClick={() => setView("password")}
              disabled={loading}
              className="w-full flex flex-col items-center gap-1 bg-white/[0.08] text-white py-3 rounded-xl font-medium hover:bg-white/[0.15] transition-all disabled:opacity-50"
            >
              <span className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Enter password manually
              </span>
              <span className="text-xs text-white/40 font-normal">Recommended if using a shared computer</span>
            </button>

            <button
              onClick={() => {
                setForgotPasswordEmail(email);
                setView("forgotPassword");
              }}
              className="w-full py-2 text-white/50 text-sm hover:text-white transition-colors"
            >
              Forgot password?
            </button>

            <button
              onClick={goBack}
              className="w-full py-2 text-white/50 text-sm hover:text-white transition-colors"
            >
              Back
            </button>
          </div>
        )}

        {/* Password entry view */}
        {view === "password" && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <p className="text-white/60 text-sm">{email}</p>

            {isNewUser && (
              <p className="text-sm text-white/50">
                Create a password for your new account
              </p>
            )}

            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoFocus={!password}
                className="w-full px-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-all"
              />
            </div>

            {isNewUser && (
              <div>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  className="w-full px-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-all"
                />
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-red-400 text-xs mt-1">Passwords don&apos;t match</p>
                )}
                <p className="text-white/40 text-xs mt-2">Password must be at least 6 characters</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !password || (isNewUser && (password !== confirmPassword || password.length < 6))}
              className="w-full py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-all disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-gray-400 border-t-black rounded-full animate-spin mx-auto" />
              ) : isNewUser ? (
                "Create Account"
              ) : (
                "Sign In"
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setForgotPasswordEmail(email);
                setView("forgotPassword");
              }}
              className="w-full py-2 text-white/50 text-sm hover:text-white transition-colors"
            >
              Forgot password?
            </button>

            <button
              type="button"
              onClick={goBack}
              className="w-full py-2 text-white/50 text-sm hover:text-white transition-colors"
            >
              Back
            </button>
          </form>
        )}

        {/* Forgot password view */}
        {view === "forgotPassword" && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <p className="text-white/60 text-sm mb-4">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>

            <div>
              <input
                type="email"
                value={forgotPasswordEmail || email}
                onChange={(e) => setForgotPasswordEmail(e.target.value)}
                placeholder="Enter your email"
                autoFocus
                className="w-full px-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !(forgotPasswordEmail || email).trim()}
              className="w-full py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-all disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-gray-400 border-t-black rounded-full animate-spin mx-auto" />
              ) : (
                "Send Reset Link"
              )}
            </button>

            <button
              type="button"
              onClick={goBack}
              className="w-full py-2 text-white/50 text-sm hover:text-white transition-colors"
            >
              Back to sign-in options
            </button>
          </form>
        )}

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-white/[0.08]">
          <p className="text-xs text-white/40 text-center">
            By signing in, you agree to our{" "}
            <Link href="/terms" className="text-white/60 hover:text-white underline">
              Terms of Use
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-white/60 hover:text-white underline">
              Privacy Policy
            </Link>
          </p>
        </div>

        {!inline && (
          <button
            onClick={onClose}
            className="w-full mt-3 py-2 text-white/40 text-sm hover:text-white transition-colors"
          >
            Cancel
          </button>
        )}
    </Wrapper>
  );
}
