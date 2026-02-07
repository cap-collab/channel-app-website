'use client';

import { useState, useCallback } from 'react';

interface InviteCardProps {
  message?: string;
}

export function InviteCard({ message = 'Know a DJ? Invite them to Channel' }: InviteCardProps) {
  const [copySuccess, setCopySuccess] = useState(false);

  const handleCopyUrl = useCallback(async () => {
    try {
      const url = `${window.location.origin}/studio/join`;
      await navigator.clipboard.writeText(url);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error('Failed to copy URL:', error);
    }
  }, []);

  return (
    <div className="w-full">
      {/* Card matching TicketCard dimensions */}
      <div className="relative w-full aspect-[16/9] overflow-hidden border border-white/10 border-dashed bg-white/5 flex flex-col items-center justify-center p-4">
        <p className="text-gray-400 text-sm text-center mb-3">{message}</p>
        <button
          onClick={handleCopyUrl}
          className="inline-flex items-center gap-2 px-4 py-2 rounded bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
        >
          {copySuccess ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy invite link
            </>
          )}
        </button>
      </div>

      {/* Empty footer to match TicketCard spacing */}
      <div className="h-8 mt-2" />
    </div>
  );
}
