"use client";

import { useState } from "react";
import { useFavorites } from "@/hooks/useFavorites";
import { useAuthContext } from "@/contexts/AuthContext";
import { AuthModal } from "@/components/AuthModal";

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
  showName?: string;
}

export function WatchlistModal({ isOpen, onClose, djs, showName }: WatchlistModalProps) {
  const { user } = useAuthContext();
  const { addToWatchlist, isInWatchlist } = useFavorites();

  // Build items list: show name first (if provided), then DJs
  const initialItems = [
    ...(showName ? [{ name: showName, type: 'show' as const }] : []),
    ...djs.map((dj) => ({ name: dj.name, type: 'dj' as const, dj })),
  ];

  const [itemNames, setItemNames] = useState<string[]>(initialItems.map((item) => item.name));
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const [addedIndices, setAddedIndices] = useState<Set<number>>(new Set());
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingAddIndex, setPendingAddIndex] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleNameChange = (index: number, value: string) => {
    setItemNames((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  };

  const handleAddSingle = async (index: number) => {
    const name = itemNames[index].trim();
    if (!name || isInWatchlist(name)) return;

    // If not logged in, show auth modal and save pending action
    if (!user) {
      setPendingAddIndex(index);
      setShowAuthModal(true);
      return;
    }

    setLoadingIndex(index);
    try {
      const item = initialItems[index];
      // Only pass userId/email for DJ items
      const djInfo = item.type === 'dj' ? item.dj : undefined;
      await addToWatchlist(name, djInfo?.userId, djInfo?.email);
      setAddedIndices((prev) => new Set(prev).add(index));
    } catch (error) {
      console.error("Error adding to watchlist:", error);
    } finally {
      setLoadingIndex(null);
    }
  };

  const handleAuthClose = () => {
    setShowAuthModal(false);
    // If user just logged in and we have a pending add, execute it
    if (user && pendingAddIndex !== null) {
      const index = pendingAddIndex;
      setPendingAddIndex(null);
      handleAddSingle(index);
    } else {
      setPendingAddIndex(null);
    }
  };

  const allInWatchlist = itemNames.every(
    (name, index) =>
      (name.trim() && isInWatchlist(name.trim())) || addedIndices.has(index)
  );

  return (
    <>
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
            Get notified when these shows or DJs are on the schedule.
          </p>

          <div className="space-y-3 mb-6">
            {itemNames.map((name, index) => {
              const inWatchlist = isInWatchlist(name.trim());
              const justAdded = addedIndices.has(index);
              const isLoading = loadingIndex === index;
              const itemType = initialItems[index]?.type;

              return (
                <div key={index} className="flex items-center gap-2">
                  {/* Label for item type */}
                  <span className="text-white/40 text-xs w-10 flex-shrink-0">
                    {itemType === 'show' ? 'Show' : 'DJ'}
                  </span>
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

      {/* Auth Modal - shown when user tries to add without being logged in */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={handleAuthClose}
        message="Sign in to add DJs to your watchlist"
      />
    </>
  );
}
