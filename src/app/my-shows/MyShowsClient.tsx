"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuthContext } from "@/contexts/AuthContext";
import { useFavorites, Favorite } from "@/hooks/useFavorites";
import { AuthModal } from "@/components/AuthModal";

export function MyShowsClient() {
  const { isAuthenticated, loading: authLoading } = useAuthContext();
  const { favorites, loading: favoritesLoading, removeFavorite } = useFavorites();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const shows = favorites.filter((f) => f.type === "show" || f.type === "dj");
  const watchlist = favorites.filter((f) => f.type === "search");

  const handleRemove = async (favorite: Favorite) => {
    setRemoving(favorite.id);
    // Create a mock show object for the removeFavorite function
    const mockShow = {
      id: favorite.id,
      name: favorite.showName || favorite.term,
      dj: favorite.djName,
      stationId: favorite.stationId || "",
      startTime: "",
      endTime: "",
    };
    await removeFavorite(mockShow);
    setRemoving(null);
  };

  if (authLoading || favoritesLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="p-4 border-b border-gray-900">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <Link
            href="/djshows"
            className="text-gray-600 hover:text-white text-sm transition-colors"
          >
            ← Back
          </Link>
          <h1 className="text-lg font-medium text-white">My Shows</h1>
          <Link
            href="/settings"
            className="text-gray-600 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </Link>
        </div>
      </header>

      <main className="max-w-xl mx-auto p-4">
        {!isAuthenticated ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-6">
              Sign in to see your saved shows
            </p>
            <button
              onClick={() => setShowAuthModal(true)}
              className="bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              Sign In
            </button>
          </div>
        ) : favorites.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">No saved shows yet</p>
            <Link
              href="/djshows"
              className="text-white hover:underline"
            >
              Browse shows →
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Shows */}
            {shows.length > 0 && (
              <section>
                <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                  Saved Shows ({shows.length})
                </h2>
                <div className="space-y-2">
                  {shows.map((favorite) => (
                    <div
                      key={favorite.id}
                      className="bg-gray-900/50 rounded-lg p-4 flex items-center justify-between"
                    >
                      <div>
                        <p className="text-white font-medium">
                          {favorite.showName || favorite.term}
                        </p>
                        {favorite.djName && (
                          <p className="text-gray-500 text-sm">{favorite.djName}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemove(favorite)}
                        disabled={removing === favorite.id}
                        className="text-gray-600 hover:text-red-400 transition-colors disabled:opacity-50"
                      >
                        {removing === favorite.id ? (
                          <div className="w-5 h-5 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Watchlist */}
            {watchlist.length > 0 && (
              <section>
                <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                  Watchlist ({watchlist.length})
                </h2>
                <p className="text-gray-600 text-sm mb-3">
                  Get notified when shows match these search terms
                </p>
                <div className="space-y-2">
                  {watchlist.map((favorite) => (
                    <div
                      key={favorite.id}
                      className="bg-gray-900/50 rounded-lg p-4 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                          />
                        </svg>
                        <p className="text-white">{favorite.term}</p>
                      </div>
                      <button
                        onClick={() => handleRemove(favorite)}
                        disabled={removing === favorite.id}
                        className="text-gray-600 hover:text-red-400 transition-colors disabled:opacity-50"
                      >
                        {removing === favorite.id ? (
                          <div className="w-5 h-5 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
