'use client';

import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { ArchivePlayerContext } from '@/contexts/ArchivePlayerContext';
import { useContext } from 'react';

const STORAGE_KEY_FILED = 'radio-email-filed';
const SESSION_KEY_COUNT = 'email-popup-count';
const SESSION_KEY_LAST = 'email-popup-last-shown';
const MAX_POPUPS_PER_SESSION = 2;
const MIN_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const SITE_DELAY_MS = 5000; // 5 seconds
const PLAY_DELAY_S = 10; // 10 seconds of playback

function getSessionCount(): number {
  if (typeof window === 'undefined') return 0;
  return parseInt(sessionStorage.getItem(SESSION_KEY_COUNT) || '0', 10);
}

function getLastShown(): number {
  if (typeof window === 'undefined') return 0;
  return parseInt(sessionStorage.getItem(SESSION_KEY_LAST) || '0', 10);
}

function recordShown() {
  const count = getSessionCount() + 1;
  sessionStorage.setItem(SESSION_KEY_COUNT, String(count));
  sessionStorage.setItem(SESSION_KEY_LAST, String(Date.now()));
}

function canShow(): boolean {
  if (getSessionCount() >= MAX_POPUPS_PER_SESSION) return false;
  const last = getLastShown();
  if (last > 0 && Date.now() - last < MIN_INTERVAL_MS) return false;
  return true;
}

function hasFiledEmail(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY_FILED) === 'true';
}

export function EmailPopup() {
  const { isAuthenticated } = useAuthContext();
  const { isPlaying: liveIsPlaying } = useBroadcastStreamContext();
  const archiveCtx = useContext(ArchivePlayerContext);
  const archiveIsPlaying = archiveCtx?.isPlaying ?? false;

  const isPlaying = liveIsPlaying || archiveIsPlaying;

  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  const cumulativePlayRef = useRef(0);
  const siteTimerFiredRef = useRef(false);
  const playTimerFiredRef = useRef(false);
  const suppressedRef = useRef(false);

  // Suppress entirely if authenticated or already filed
  useEffect(() => {
    if (isAuthenticated || hasFiledEmail()) {
      suppressedRef.current = true;
    }
  }, [isAuthenticated]);

  const maybeShow = useCallback(() => {
    if (suppressedRef.current || isOpen) return;
    if (isAuthenticated || hasFiledEmail()) return;
    if (!canShow()) return;
    recordShown();
    setIsOpen(true);
  }, [isAuthenticated, isOpen]);

  // Trigger A: 5 seconds on site
  useEffect(() => {
    if (suppressedRef.current || siteTimerFiredRef.current) return;
    const timer = setTimeout(() => {
      siteTimerFiredRef.current = true;
      maybeShow();
    }, SITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [maybeShow]);

  // Trigger B: 10 seconds of cumulative playback
  useEffect(() => {
    if (suppressedRef.current || playTimerFiredRef.current || !isPlaying) return;

    const interval = setInterval(() => {
      cumulativePlayRef.current += 1;
      if (cumulativePlayRef.current >= PLAY_DELAY_S && !playTimerFiredRef.current) {
        playTimerFiredRef.current = true;
        maybeShow();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, maybeShow]);

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('submitting');
    try {
      const res = await fetch('/api/radio-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      setStatus('success');
      setEmail('');
      localStorage.setItem(STORAGE_KEY_FILED, 'true');
      suppressedRef.current = true;
      // Auto-close after success
      setTimeout(() => setIsOpen(false), 2000);
    } catch {
      setStatus('error');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="bg-white/[0.08] backdrop-blur-xl rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-white/[0.1] relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {status === 'success' ? (
          <div className="text-center py-4">
            <p className="text-green-400 text-lg font-semibold">You&apos;re on the list!</p>
            <p className="text-zinc-400 text-sm mt-2">We&apos;ll keep you posted.</p>
          </div>
        ) : (
          <>
            <h3 className="text-white font-bold text-lg mb-1">Stay in the loop</h3>
            <p className="text-zinc-400 text-sm mb-5">Get notified about upcoming shows</p>

            <form onSubmit={handleSubmit} className="flex gap-0">
              <input
                type="email"
                placeholder="Your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-white/10 border border-white/20 rounded-l-lg px-4 py-3 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-white/40 min-w-0 flex-1"
              />
              <button
                type="submit"
                disabled={status === 'submitting'}
                className="bg-white text-black font-semibold rounded-r-lg px-5 py-3 text-sm hover:bg-gray-200 transition-colors disabled:opacity-50 shrink-0"
              >
                {status === 'submitting' ? '...' : 'Submit'}
              </button>
            </form>
            {status === 'error' && (
              <p className="text-red-400 text-xs mt-2">Something went wrong. Try again.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
