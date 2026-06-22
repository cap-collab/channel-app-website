'use client';

import { useEffect, useState } from 'react';

// Small fixed indicator shown only while this browser is in private test mode
// (see useBroadcastLiveStatus.ts — ?testmode=1 unhides the channelbroadcast
// admin test broadcast on THIS browser so go-live / back-to-back / transitions
// can be watched and heard like a real show). Renders nothing for the public.
// Tap it to exit test mode (clears the flag and reloads to the normal site).
const TEST_MODE_KEY = 'channelTestMode';

export function TestModeBadge() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const param = params.get('testmode');
      if (param === '1' || param === 'true') {
        window.localStorage.setItem(TEST_MODE_KEY, '1');
      } else if (param === '0' || param === 'false') {
        window.localStorage.removeItem(TEST_MODE_KEY);
      }
      setOn(window.localStorage.getItem(TEST_MODE_KEY) === '1');
    } catch {
      setOn(false);
    }
  }, []);

  if (!on) return null;

  const exit = () => {
    try {
      window.localStorage.removeItem(TEST_MODE_KEY);
    } catch {}
    // Reload onto the bare path so the test broadcast goes back to hidden.
    window.location.href = window.location.pathname;
  };

  return (
    <button
      onClick={exit}
      title="Private test mode is ON — only you see the channelbroadcast test stream. Tap to exit."
      style={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        zIndex: 2147483647,
        padding: '6px 10px',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.08em',
        color: '#000',
        background: '#ff3b3b',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'var(--font-geist-mono), monospace',
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      }}
    >
      TEST MODE · EXIT
    </button>
  );
}
