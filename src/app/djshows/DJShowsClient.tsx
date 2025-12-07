"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { SearchBar } from "@/components/SearchBar";
import { CalendarGrid } from "@/components/calendar/CalendarGrid";
import { NowPlayingGrid } from "@/components/calendar/NowPlayingGrid";
import { AuthModal } from "@/components/AuthModal";
import { useAuthContext } from "@/contexts/AuthContext";

export function DJShowsClient() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showNowPlaying, setShowNowPlaying] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { user, isAuthenticated, signOut, loading } = useAuthContext();

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-black">
      {/* Header */}
      <header className="bg-black p-4 border-b border-gray-900">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <Link href="/">
              <Image
                src="/logo-white.svg"
                alt="CHANNEL"
                width={120}
                height={24}
                className="h-6 w-auto"
                priority
              />
            </Link>

            {/* User menu */}
            <div className="relative">
              {loading ? (
                <div className="w-8 h-8 rounded-full bg-gray-800 animate-pulse" />
              ) : isAuthenticated && user ? (
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="w-8 h-8 rounded-full overflow-hidden border border-gray-800 hover:border-gray-600 transition-colors"
                >
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || "User"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gray-800 flex items-center justify-center text-white text-xs font-medium">
                      {user.displayName?.charAt(0) || user.email?.charAt(0) || "?"}
                    </div>
                  )}
                </button>
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="text-gray-500 hover:text-white text-sm transition-colors"
                >
                  Sign In
                </button>
              )}

              {/* Dropdown menu */}
              {showUserMenu && isAuthenticated && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowUserMenu(false)}
                  />
                  <div className="absolute right-0 top-10 z-50 bg-black border border-gray-800 rounded-lg py-1 min-w-[160px]">
                    <div className="px-3 py-2 border-b border-gray-800">
                      <p className="text-white text-sm font-medium truncate">
                        {user?.displayName}
                      </p>
                      <p className="text-gray-500 text-xs truncate">
                        {user?.email}
                      </p>
                    </div>
                    <Link
                      href="/my-shows"
                      onClick={() => setShowUserMenu(false)}
                      className="block w-full px-3 py-2 text-left text-sm text-gray-400 hover:text-white hover:bg-gray-900 transition-colors"
                    >
                      My Shows
                    </Link>
                    <Link
                      href="/settings"
                      onClick={() => setShowUserMenu(false)}
                      className="block w-full px-3 py-2 text-left text-sm text-gray-400 hover:text-white hover:bg-gray-900 transition-colors"
                    >
                      Settings
                    </Link>
                    <button
                      onClick={() => {
                        signOut();
                        setShowUserMenu(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-gray-400 hover:text-white hover:bg-gray-900 transition-colors"
                    >
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <SearchBar
                onSearch={handleSearch}
                placeholder="Search shows or DJs..."
              />
            </div>
            <button
              onClick={() => setShowNowPlaying(true)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-black rounded-lg font-medium hover:bg-gray-100 transition-colors whitespace-nowrap text-sm"
            >
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              Live Now
            </button>
          </div>
        </div>
      </header>

      {/* Calendar Grid */}
      <main className="flex-1 min-h-0">
        <CalendarGrid searchQuery={searchQuery} onClearSearch={handleClearSearch} />
      </main>

      {/* Now Playing Overlay */}
      {showNowPlaying && (
        <NowPlayingGrid onClose={() => setShowNowPlaying(false)} />
      )}

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
