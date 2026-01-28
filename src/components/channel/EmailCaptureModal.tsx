'use client';

import { useState } from 'react';
import { Show } from '@/types';

interface EmailCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  show: Show | null;
  onSubmit: (email: string, show: Show) => Promise<void>;
  onSignInClick: () => void;
}

function formatShowTime(isoTime: string): string {
  const date = new Date(isoTime);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function EmailCaptureModal({
  isOpen,
  onClose,
  show,
  onSubmit,
  onSignInClick,
}: EmailCaptureModalProps) {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen || !show) return null;

  const djName = show.dj || show.name;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(email, show);
      setSuccess(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setError(null);
    setSuccess(false);
    onClose();
  };

  const handleSignIn = () => {
    handleClose();
    onSignInClick();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-surface-elevated rounded-2xl w-full max-w-md p-6 shadow-2xl">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {success ? (
          /* Success State */
          <div className="text-center py-4">
            <div className="w-16 h-16 mx-auto mb-4 bg-accent/20 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-white text-xl font-bold mb-2">You&apos;re all set!</h3>
            <p className="text-gray-400 mb-4">
              We&apos;ll notify you when {djName} goes live.
            </p>
            <button
              onClick={handleClose}
              className="w-full py-3 bg-accent hover:bg-accent-hover text-white rounded-xl font-semibold transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          /* Form State */
          <>
            <h3 className="text-white text-xl font-bold mb-2 pr-8">
              Get notified when {djName} plays
            </h3>
            <p className="text-gray-400 text-sm mb-1">
              {formatShowTime(show.startTime)}
            </p>
            <p className="text-gray-500 text-sm mb-6">
              Leave your email to get live alerts and DJ updates.
            </p>

            <form onSubmit={handleSubmit}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-4 py-3 bg-black/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-accent transition-colors mb-3"
                autoFocus
              />

              {error && (
                <p className="text-red-400 text-sm mb-3">{error}</p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-accent hover:bg-accent-hover text-white rounded-xl font-semibold transition-colors disabled:opacity-50"
              >
                {isSubmitting ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Setting up...
                  </div>
                ) : (
                  'Remind Me'
                )}
              </button>
            </form>

            <div className="mt-4 pt-4 border-t border-gray-800 text-center">
              <p className="text-gray-500 text-sm">
                Already have an account?{' '}
                <button
                  onClick={handleSignIn}
                  className="text-accent hover:underline"
                >
                  Sign in
                </button>
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
