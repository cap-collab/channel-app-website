"use client";

import { useState } from "react";
import { useUserPreferences } from "@/hooks/useUserPreferences";

interface NotificationPromptProps {
  isOpen: boolean;
  onClose: () => void;
  onEnabled?: () => void;
}

export function NotificationPrompt({
  isOpen,
  onClose,
  onEnabled,
}: NotificationPromptProps) {
  const { enableNotifications } = useUserPreferences();
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleEnable = async () => {
    setLoading(true);
    const success = await enableNotifications();
    setLoading(false);
    if (success) {
      onEnabled?.();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90"
      onClick={onClose}
    >
      <div
        className="bg-black border border-gray-800 rounded-xl p-6 max-w-sm w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
        </div>

        <h2 className="text-xl font-bold text-white mb-2 text-center">
          Get Notified
        </h2>
        <p className="text-gray-400 text-sm mb-6 text-center">
          Want to receive email alerts when your favorite DJs or shows are scheduled?
        </p>

        <div className="space-y-3">
          <button
            onClick={handleEnable}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-white text-black py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-gray-400 border-t-black rounded-full animate-spin" />
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Yes, notify me
              </>
            )}
          </button>

          <button
            onClick={onClose}
            className="w-full py-2 text-gray-500 text-sm hover:text-white transition-colors"
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
