"use client";

import { useState } from "react";
import { useFavorites } from "@/hooks/useFavorites";

interface DJ {
  name: string;
  username?: string;
  userId?: string;
  email?: string;
}

interface WatchlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  djs: DJ[];
}

export function WatchlistModal({ isOpen, onClose, djs }: WatchlistModalProps) {
  const { addToWatchlist, isInWatchlist } = useFavorites();
  const [djNames, setDjNames] = useState<string[]>(djs.map((dj) => dj.name));
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleNameChange = (index: number, value: string) => {
    setDjNames((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  };

  const handleAddToWatchlist = async () => {
    setLoading(true);
    try {
      for (let i = 0; i < djNames.length; i++) {
        const name = djNames[i].trim();
        if (name && !isInWatchlist(name)) {
          const dj = djs[i];
          await addToWatchlist(name, dj?.userId, dj?.email);
        }
      }
      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 1500);
    } catch (error) {
      console.error("Error adding to watchlist:", error);
    } finally {
      setLoading(false);
    }
  };

  // Check if all DJs are already in watchlist
  const allAlreadyInWatchlist = djNames.every(
    (name) => name.trim() && isInWatchlist(name.trim())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white/[0.08] backdrop-blur-xl rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-white/[0.1]"
        onClick={(e) => e.stopPropagation()}
      >
        {success ? (
          <>
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-green-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            </div>
            <h2 className="text-xl font-bold text-white mb-2 text-center">
              Added to watchlist
            </h2>
            <p className="text-white/60 text-sm text-center">
              You&apos;ll be notified when they have upcoming shows.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold text-white mb-2">
              Add to Watchlist
            </h2>
            <p className="text-white/50 text-sm mb-6">
              Get notified when these DJs have upcoming shows.
            </p>

            <div className="space-y-3 mb-6">
              {djNames.map((name, index) => (
                <div key={index}>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => handleNameChange(index, e.target.value)}
                    className="w-full px-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-all"
                  />
                  {isInWatchlist(name.trim()) && (
                    <p className="text-green-400 text-xs mt-1">
                      Already in your watchlist
                    </p>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={handleAddToWatchlist}
              disabled={
                loading ||
                allAlreadyInWatchlist ||
                djNames.every((n) => !n.trim())
              }
              className="w-full py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-all disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-gray-400 border-t-black rounded-full animate-spin mx-auto" />
              ) : allAlreadyInWatchlist ? (
                "Already in watchlist"
              ) : (
                "Add to watchlist"
              )}
            </button>

            <button
              onClick={onClose}
              className="w-full mt-3 py-2 text-white/40 text-sm hover:text-white transition-colors"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
