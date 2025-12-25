"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuthContext } from "@/contexts/AuthContext";
import { AuthModal } from "@/components/AuthModal";

interface BroadcastHeaderProps {
  stationName?: string;
}

export function BroadcastHeader({ stationName = "Channel Broadcast" }: BroadcastHeaderProps) {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { user, isAuthenticated, signOut, loading } = useAuthContext();

  return (
    <>
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-md border-b border-gray-900">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Image
                src="/logo-white.svg"
                alt="CHANNEL"
                width={140}
                height={28}
                className="h-7 w-auto"
                priority
              />
            </Link>
            <span className="text-gray-500">|</span>
            <span className="text-white font-medium">{stationName}</span>
          </div>
          <div className="flex items-center gap-3">
            {/* User menu or sign in */}
            {loading ? (
              <div className="w-8 h-8 rounded-full bg-gray-800 animate-pulse" />
            ) : isAuthenticated && user ? (
              <div className="relative">
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

                {showUserMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowUserMenu(false)}
                    />
                    <div className="absolute right-0 top-10 z-50 bg-black border border-gray-800 rounded-lg py-1 min-w-[160px]">
                      <div className="px-3 py-2 border-b border-gray-800">
                        <p className="text-white text-sm font-medium truncate">
                          {user.displayName || user.email?.split("@")[0]}
                        </p>
                        <p className="text-gray-500 text-xs truncate">
                          {user.email}
                        </p>
                      </div>
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
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="w-8 h-8 rounded-full bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-colors"
                title="Sign in"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}
