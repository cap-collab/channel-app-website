"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuthContext } from "@/contexts/AuthContext";
import { AuthModal } from "@/components/AuthModal";
import { MobileMenu, MobileMenuItem } from "@/components/MobileMenu";
import { useBroadcastLiveStatus } from "@/hooks/useBroadcastLiveStatus";

type CurrentPage = "home" | "djshows" | "apply" | "broadcast-admin" | "channel" | "dj-portal" | "radio-portal";

interface HeaderProps {
  currentPage?: CurrentPage;
  position?: "fixed" | "sticky";
}

export function Header({ currentPage = "home", position = "fixed" }: HeaderProps) {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { user, isAuthenticated, signOut, loading } = useAuthContext();
  const { isLive } = useBroadcastLiveStatus();

  // Build mobile menu items based on current page
  const getMobileMenuItems = (): MobileMenuItem[] => {
    const items: MobileMenuItem[] = [];

    // Live Now button - first when live and not on /channel
    if (isLive && currentPage !== "channel") {
      items.push({ label: "🔴 Live Now", href: "/channel" });
    }

    // iOS Beta always first (after Live Now if present)
    items.push({ label: "iOS Beta", href: "https://testflight.apple.com/join/HcKTJ1nH", external: true });

    // Browse DJ Shows button hidden
    if (false && currentPage !== "djshows") {
      items.push({ label: "Browse DJ Shows", href: "/djshows" });
    }
    // Get Involved - anchor on home/djshows (both have the section), full URL on apply
    const getInvolvedHref = currentPage === "apply" ? "/#get-involved" : "#get-involved";
    items.push({ label: "Get Involved", href: getInvolvedHref });
    if (currentPage !== "dj-portal") {
      items.push({ label: "DJ Portal", href: "/dj-portal" });
    }
    if (currentPage !== "broadcast-admin" && currentPage !== "radio-portal") {
      items.push({ label: "Radio Portal", href: "/radio-portal" });
    }
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
          <div className="flex items-center gap-3 md:gap-4">
            {/* Navigation links - same on all pages, hide link to current page */}
            {/* Browse DJ Shows button hidden */}
            {false && currentPage !== "djshows" && (
              <Link
                href="/djshows"
                className="hidden sm:inline-block text-gray-400 hover:text-white text-sm transition-colors"
              >
                Browse DJ Shows
              </Link>
            )}
            <a
              href={currentPage === "apply" ? "/#get-involved" : "#get-involved"}
              className="hidden sm:inline-block text-gray-400 hover:text-white text-sm transition-colors"
            >
              Get Involved
            </a>
            {currentPage !== "dj-portal" && (
              <Link
                href="/dj-portal"
                className="hidden sm:inline-block text-gray-400 hover:text-white text-sm transition-colors"
              >
                DJ Portal
              </Link>
            )}
            {currentPage !== "broadcast-admin" && currentPage !== "radio-portal" && (
              <Link
                href="/radio-portal"
                className="hidden sm:inline-block text-gray-400 hover:text-white text-sm transition-colors"
              >
                Radio Portal
              </Link>
            )}

            {/* Sign In - only on non-home pages when not authenticated */}
            {/* Sign In button hidden */}
            {false && currentPage !== "home" && !isAuthenticated && !loading && (
              <button
                onClick={() => setShowAuthModal(true)}
                className="hidden sm:inline-block text-gray-400 hover:text-white text-sm transition-colors"
              >
                Sign In
              </button>
            )}

            {/* Live Now button - only show when broadcast is live and not on /channel */}
            {isLive && currentPage !== "channel" && (
              <Link
                href="/channel"
                className="hidden sm:inline-flex items-center gap-1.5 bg-red-600 text-white px-3 sm:px-4 py-1.5 rounded-lg text-sm font-semibold hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(239,68,68,0.4)] transition-all whitespace-nowrap animate-pulse"
              >
                <span className="w-2 h-2 bg-white rounded-full" />
                Live Now
              </Link>
            )}

            {/* Main CTA button - iOS Beta on all pages */}
            <a
              href="https://testflight.apple.com/join/HcKTJ1nH"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white text-black px-3 sm:px-4 py-1.5 rounded-lg text-sm font-semibold hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(255,255,255,0.2)] transition-all whitespace-nowrap"
            >
              iOS Beta
            </a>

            {/* User/Guest icon - always visible */}
            <div className="relative hidden sm:block">
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
