'use client';

import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { ArchivePlayerContext } from '@/contexts/ArchivePlayerContext';
import { useContext } from 'react';

const STORAGE_KEY_FILED = 'radio-email-filed';       // localStorage — persists forever after submit
const SESSION_KEY_SHOWN = 'email-popup-shown';         // sessionStorage — once per session
const PLAY_DELAY_S = 30; // 30 seconds of playback

function hasFiledEmail(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY_FILED) === 'true';
}

function hasShownThisSession(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(SESSION_KEY_SHOWN) === 'true';
}

function recordShown() {
  sessionStorage.setItem(SESSION_KEY_SHOWN, 'true');
}

export function EmailPopup({ siteDelayMs, suppress }: { siteDelayMs?: number; suppress?: boolean } = {}) {
  const { isAuthenticated } = useAuthContext();
  const { isPlaying: liveIsPlaying } = useBroadcastStreamContext();
  const archiveCtx = useContext(ArchivePlayerContext);
  const archiveIsPlaying = archiveCtx?.isPlaying ?? false;

  const isPlaying = liveIsPlaying || archiveIsPlaying;

  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  // Allow external components to open the popup via custom event
  useEffect(() => {
    const handler = () => {
      if (suppressedRef.current) return;
      if (isAuthenticated || hasFiledEmail() || hasShownThisSession()) return;
      recordShown();
      suppressedRef.current = true;
      setIsOpen(true);
    };
    window.addEventListener('open-email-popup', handler);
    return () => window.removeEventListener('open-email-popup', handler);
  }, [isAuthenticated]);

  const cumulativePlayRef = useRef(0);
  const siteTimerFiredRef = useRef(false);
  const playTimerFiredRef = useRef(false);
  const suppressedRef = useRef(false);

  // Suppress entirely if authenticated, already filed, already shown this session, or externally suppressed
  useEffect(() => {
    if (isAuthenticated || hasFiledEmail() || hasShownThisSession() || suppress) {
      suppressedRef.current = true;
    } else {
      suppressedRef.current = false;
    }
  }, [isAuthenticated, suppress]);

  const maybeShow = useCallback(() => {
    if (suppressedRef.current || isOpen) return;
    if (isAuthenticated || hasFiledEmail() || hasShownThisSession()) return;
    recordShown();
    suppressedRef.current = true;
    setIsOpen(true);
  }, [isAuthenticated, isOpen]);

  // Trigger A: time-on-page (only if siteDelayMs is provided, e.g. DJ profile pages)
  useEffect(() => {
    if (!siteDelayMs || suppressedRef.current || siteTimerFiredRef.current) return;
    const timer = setTimeout(() => {
      siteTimerFiredRef.current = true;
      maybeShow();
    }, siteDelayMs);
    return () => clearTimeout(timer);
  }, [siteDelayMs, maybeShow]);

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
