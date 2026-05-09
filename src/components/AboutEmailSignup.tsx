'use client';

import { useState, FormEvent } from 'react';
import { captureEvent } from '@/lib/posthog';
import { trackLeadConversion } from '@/lib/gtag';

export function AboutEmailSignup() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('submitting');
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch('/api/radio-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), timezone }),
      });
      if (!res.ok) throw new Error('Request failed');
      captureEvent('email_submitted', { source: 'about_page' });
      trackLeadConversion();
      setStatus('success');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'success') {
    return <p className="text-green-400 text-sm py-3">You&apos;re on the list!</p>;
  }

  return (
    <div className="flex flex-col w-full max-w-md">
      <form onSubmit={handleSubmit} className="flex justify-center h-full">
        <input
          type="email"
          placeholder="Get really cool email updates"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="bg-white/10 border border-white/20 rounded-l px-4 py-3 text-white placeholder-gray-400 text-sm focus:outline-none focus:border-white/40 min-w-[250px] flex-1 h-[48px]"
        />
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="bg-white/20 border border-white/20 border-l-0 rounded-r px-4 py-3 text-white text-sm font-medium hover:bg-white/30 transition-colors disabled:opacity-50 shrink-0 h-[48px]"
        >
          {status === 'submitting' ? '...' : 'Submit'}
        </button>
      </form>
      {status === 'error' && (
        <p className="text-red-400 text-xs mt-1 text-center">Something went wrong. Try again.</p>
      )}
    </div>
  );
}
