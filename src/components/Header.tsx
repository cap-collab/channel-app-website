"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuthContext } from "@/contexts/AuthContext";
import { AuthModal } from "@/components/AuthModal";
import { MobileMenu, MobileMenuItem } from "@/components/MobileMenu";
import { HeaderSearch } from "@/components/HeaderSearch";
import { useBroadcastLiveStatus } from "@/hooks/useBroadcastLiveStatus";
import { useUserRole, isDJ } from "@/hooks/useUserRole";

type CurrentPage = "home" | "djshows" | "apply" | "broadcast-admin" | "channel" | "dj-portal" | "radio-portal" | "my-shows" | "streaming-guide" | "stripe-setup" | "studio";

interface HeaderProps {
  currentPage?: CurrentPage;
  position?: "fixed" | "sticky";
}

export function Header({ currentPage = "home", position = "fixed" }: HeaderProps) {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { user, isAuthenticated, signOut, loading } = useAuthContext();
  const { isLive } = useBroadcastLiveStatus();
  const { role } = useUserRole(user);

  // Build mobile menu items - static menu with current page highlighted
  const getMobileMenuItems = (): MobileMenuItem[] => {
    const items: MobileMenuItem[] = [];

    // Home button - Live Now when live, standard Home when offline
    if (isLive) {
      items.push({ label: "🔴 Live Now", href: "/channel", active: currentPage === "channel" });
    } else {
      items.push({ label: "Home", href: "/channel", active: currentPage === "channel" });
    }

    // DJ Studio link - hide for users who already have DJ access
    if (!isDJ(role)) {
      items.push({ label: "DJ Studio", href: "/studio/join", active: currentPage === "studio" || currentPage === "dj-portal" });
    }

    // iOS Beta
    items.push({ label: "iOS Beta", href: "https://testflight.apple.com/join/HcKTJ1nH", external: true });

    // Always show auth option in mobile menu
    items.push({ type: "auth" });

    return items;
  };

  const positionClass = position === "fixed"
    ? "fixed top-0 left-0 right-0"
    : "sticky top-0";

  return (
    <>
      <header className={`${positionClass} z-50 bg-black/80 backdrop-blur-md border-b border-gray-900`}>
        <div className="px-4 py-3 flex items-center justify-between">
          {/* Left side: Logo and nav links */}
          <div className="flex items-center gap-4 md:gap-6">
            <Link href="/channel">
              <Image
                src="/logo-white.svg"
                alt="CHANNEL"
                width={140}
                height={28}
                className="h-7 w-auto"
                priority
              />
            </Link>

            {/* Home button - Live Now with animation when live, standard Home when offline */}
            {isLive ? (
              <Link
                href="/channel"
                className={`hidden sm:inline-flex items-center gap-1.5 bg-red-600 text-white px-3 sm:px-4 py-1.5 rounded-lg text-sm font-semibold hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(239,68,68,0.4)] transition-all whitespace-nowrap animate-pulse ${
                  currentPage === "channel" ? "ring-2 ring-white/30" : ""
                }`}
              >
                <span className="w-2 h-2 bg-white rounded-full" />
                Live Now
              </Link>
            ) : (
              <Link
                href="/channel"
                className={`hidden sm:inline-block text-sm transition-colors ${
                  currentPage === "channel" ? "text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                Home
              </Link>
            )}

            {/* DJ Studio link - hide for users who already have DJ access */}
            {!isDJ(role) && (
              <Link
                href="/studio/join"
                className={`hidden sm:inline-block text-sm transition-colors ${
                  currentPage === "studio" || currentPage === "dj-portal" ? "text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                DJ Studio
              </Link>
            )}
          </div>

          {/* Center: Search bar - hidden on mobile */}
          <div className="hidden md:flex flex-1 justify-center px-4">
            <HeaderSearch onAuthRequired={() => setShowAuthModal(true)} />
          </div>

          <div className="flex items-center gap-3 md:gap-4">
            {/* iOS Beta button - hidden on mobile, shown on desktop */}
            <a
              href="https://testflight.apple.com/join/HcKTJ1nH"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:block bg-white text-black px-3 sm:px-4 py-1.5 rounded-lg text-sm font-semibold hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(255,255,255,0.2)] transition-all whitespace-nowrap"
            >
              iOS Beta
            </a>

            {/* User/Guest icon - hidden on mobile (sign in is in mobile menu), visible on desktop */}
            <div className="relative hidden md:block">
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
                  className="w-8 h-8 rounded-full bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 transition-colors flex items-center justify-center"
                  aria-label="Sign in"
                >
                  <svg
                    className="w-4 h-4 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                </button>
              )}

              {showUserMenu && isAuthenticated && user && (
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
                      href="/my-shows"
                      onClick={() => setShowUserMenu(false)}
                      className="block w-full px-3 py-2 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                    >
                      My Favorites
                    </Link>
                    <Link
                      href="/inbox"
                      onClick={() => setShowUserMenu(false)}
                      className="block w-full px-3 py-2 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                    >
                      Inbox
                    </Link>
                    {isDJ(role) && (
                      <Link
                        href="/studio"
                        onClick={() => setShowUserMenu(false)}
                        className="block w-full px-3 py-2 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                      >
                        DJ Studio
                      </Link>
                    )}
                    <Link
                      href="/settings"
                      onClick={() => setShowUserMenu(false)}
                      className="block w-full px-3 py-2 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                    >
                      Settings
                    </Link>
                    <button
                      onClick={() => {
                        signOut();
                        setShowUserMenu(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                    >
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Mobile hamburger menu */}
            <MobileMenu
              items={getMobileMenuItems()}
              onSignInClick={() => setShowAuthModal(true)}
            />
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
