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
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const [addedIndices, setAddedIndices] = useState<Set<number>>(new Set());

  if (!isOpen) return null;

  const handleNameChange = (index: number, value: string) => {
    setDjNames((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  };

  const handleAddSingle = async (index: number) => {
    const name = djNames[index].trim();
    if (!name || isInWatchlist(name)) return;

    setLoadingIndex(index);
    try {
      const dj = djs[index];
      await addToWatchlist(name, dj?.userId, dj?.email);
      setAddedIndices((prev) => new Set(prev).add(index));
    } catch (error) {
      console.error("Error adding to watchlist:", error);
    } finally {
      setLoadingIndex(null);
    }
  };

  const allInWatchlist = djNames.every(
    (name, index) =>
      (name.trim() && isInWatchlist(name.trim())) || addedIndices.has(index)
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
        <h2 className="text-xl font-bold text-white mb-2">Add to Watchlist</h2>
        <p className="text-white/50 text-sm mb-6">
          Get notified when these DJs have upcoming shows.
        </p>

        <div className="space-y-3 mb-6">
          {djNames.map((name, index) => {
            const inWatchlist = isInWatchlist(name.trim());
            const justAdded = addedIndices.has(index);
            const isLoading = loadingIndex === index;

            return (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(index, e.target.value)}
                  disabled={inWatchlist || justAdded}
                  className="flex-1 px-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-all disabled:opacity-50"
                />
                <button
                  onClick={() => handleAddSingle(index)}
                  disabled={isLoading || inWatchlist || justAdded || !name.trim()}
                  className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    inWatchlist || justAdded
                      ? "bg-green-500/20 text-green-400"
                      : "bg-white/10 hover:bg-white/20 text-white disabled:opacity-50"
                  }`}
                >
                  {isLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : inWatchlist || justAdded ? (
                    <svg
                      className="w-5 h-5"
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
                  ) : (
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 bg-white/10 text-white rounded-xl font-medium hover:bg-white/20 transition-all"
        >
          {allInWatchlist ? "Done" : "Close"}
        </button>
      </div>
    </div>
  );
}
