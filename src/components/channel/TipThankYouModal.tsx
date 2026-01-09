'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TipThankYouModalProps {
  isOpen: boolean;
  onClose: () => void;
  djUsername: string;
  thankYouMessage: string;
  tipAmountCents: number;
}

export function TipThankYouModal({
  isOpen,
  onClose,
  djUsername,
  thankYouMessage,
  tipAmountCents,
}: TipThankYouModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative z-10 bg-[#1a1a1a] border border-white/20 rounded-xl p-6 w-full max-w-[380px] shadow-2xl text-center">
        {/* Heart icon */}
        <div className="mb-4">
          <div className="w-16 h-16 mx-auto bg-accent/20 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-accent" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </div>
        </div>

        {/* Header */}
        <h2 className="text-xl font-semibold text-white mb-1">
          Thank you!
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          You sent ${(tipAmountCents / 100).toFixed(2)} to {djUsername}
        </p>

        {/* Thank you message from DJ */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-4 mb-6">
          <p className="text-sm text-gray-400 mb-2">Message from {djUsername}:</p>
          <p className="text-white italic">&ldquo;{thankYouMessage}&rdquo;</p>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="w-full py-3 rounded-lg font-medium bg-accent text-black hover:bg-accent-hover transition-all"
        >
          Close
        </button>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
