'use client';

import { useState } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';

interface DJAccountPromptProps {
  onComplete: (isLoggedIn: boolean) => void;
  onSkip: () => void;
}

export function DJAccountPrompt({ onComplete, onSkip }: DJAccountPromptProps) {
  const { signInWithGoogle, signInWithApple, loading, error } = useAuthContext();
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      const user = await signInWithGoogle(false);
      if (user) {
        onComplete(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    setIsLoading(true);
    try {
      const user = await signInWithApple(false);
      if (user) {
        onComplete(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinueAsGuest = () => {
    onSkip();
  };

  return (
    <div className="bg-gray-900 rounded-xl p-8 max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-white mb-2">
        Welcome to Channel Broadcast!
      </h2>
      <p className="text-gray-400 mb-8">
        Log in to chat with listeners on the Channel app during your set.
      </p>

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {/* Google Login */}
        <button
          onClick={handleGoogleLogin}
          disabled={isLoading || loading}
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 disabled:bg-gray-300 text-gray-900 font-medium py-3 px-4 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          {isLoading ? 'Signing in...' : 'Log in with Google'}
        </button>

        {/* Apple Login */}
        <button
          onClick={handleAppleLogin}
          disabled={isLoading || loading}
          className="w-full flex items-center justify-center gap-3 bg-black hover:bg-gray-800 disabled:bg-gray-700 text-white font-medium py-3 px-4 rounded-lg border border-gray-700 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
          </svg>
          {isLoading ? 'Signing in...' : 'Log in with Apple'}
        </button>
      </div>

      <div className="relative my-8">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-700"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-gray-900 text-gray-500">or</span>
        </div>
      </div>

      <button
        onClick={handleContinueAsGuest}
        disabled={isLoading || loading}
        className="w-full text-gray-400 hover:text-white font-medium py-3 px-4 rounded-lg transition-colors"
      >
        Continue as guest &rarr;
      </button>

      <p className="text-gray-500 text-sm mt-6 text-center">
        Guests can only chat from this page.
        <br />
        Log in to chat from the Channel mobile app too.
      </p>
    </div>
  );
}
