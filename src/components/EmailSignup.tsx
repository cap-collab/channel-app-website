'use client';

import { useState, FormEvent } from 'react';
import { addDoc, collection, getFirestore } from 'firebase/firestore';
import { getApps, initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function getFirebaseApp() {
  if (getApps().length === 0) return initializeApp(firebaseConfig);
  return getApps()[0];
}

export function EmailSignup({ placeholder = 'Get email updates' }: { placeholder?: string }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('submitting');
    try {
      const app = getFirebaseApp();
      const db = getFirestore(app);
      await addDoc(collection(db, 'radioNotifyEmails'), {
        email: email.trim(),
        createdAt: new Date(),
      });
      setStatus('success');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'success') {
    return <p className="text-green-400 text-sm py-3">You&apos;re on the list!</p>;
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex justify-center">
        <input
          type="email"
          placeholder={placeholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="bg-white/10 border border-white/20 rounded-l px-4 py-4 text-white placeholder-gray-300 text-sm focus:outline-none focus:border-white/40 min-w-0 flex-1"
        />
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="bg-white/20 border border-white/20 border-l-0 rounded-r px-4 py-4 text-white text-sm font-medium hover:bg-white/30 transition-colors disabled:opacity-50 shrink-0"
        >
          {status === 'submitting' ? '...' : 'Submit'}
        </button>
      </form>
      {status === 'error' && (
        <p className="text-red-400 text-xs mt-1">Something went wrong. Try again.</p>
      )}
    </div>
  );
}
