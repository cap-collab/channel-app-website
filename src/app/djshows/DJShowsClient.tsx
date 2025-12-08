"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { SearchBar } from "@/components/SearchBar";
import { CalendarGrid } from "@/components/calendar/CalendarGrid";
import { BrowsingModePopup } from "@/components/BrowsingModePopup";
import { AuthModal } from "@/components/AuthModal";
import { MobileMenu } from "@/components/MobileMenu";
import { useAuthContext } from "@/contexts/AuthContext";
import { BPMProvider } from "@/contexts/BPMContext";

export function DJShowsClient() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showNowPlaying, setShowNowPlaying] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isSearchBarSticky, setIsSearchBarSticky] = useState(true);
  const { user, isAuthenticated, signOut, loading } = useAuthContext();

  // Track scroll position to make search bar non-sticky after scrolling past current time
  useEffect(() => {
    const handleScroll = () => {
      const todayGrid = document.querySelector('[data-time-grid="today"]');
      if (!todayGrid) return;

      const now = new Date();
      const PIXELS_PER_HOUR = 80;
      const timePosition = (now.getHours() + now.getMinutes() / 60) * PIXELS_PER_HOUR;

      const gridTop = todayGrid.getBoundingClientRect().top;
      // Current time position relative to viewport
      const currentTimeViewportPosition = gridTop + timePosition;

      // Search bar height + header height = ~52 + ~60 = 112px
      // If current time line is above the sticky area, make search bar non-sticky
      const stickyThreshold = 120;
      setIsSearchBarSticky(currentTimeViewportPosition > stickyThreshold);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Check on mount

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  return (
    <BPMProvider>
    <div className="min-h-screen bg-black">
      {/* Header - Logo and nav only (sticky) */}
      <header className="sticky top-0 z-50 bg-black/95 backdrop-blur-md border-b border-gray-900">
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

          {/* Nav buttons and user menu */}
          <div className="flex items-center gap-3 md:gap-4">
            {/* Browse DJ Shows button - hidden on mobile */}
            <button
              onClick={() => {
                const todayGrid = document.querySelector('[data-time-grid="today"]');
                if (!todayGrid) return;

                const now = new Date();
                const PIXELS_PER_HOUR = 80;
                const timePosition = (now.getHours() + now.getMinutes() / 60) * PIXELS_PER_HOUR;

                const gridTop = todayGrid.getBoundingClientRect().top + window.scrollY;
                const totalStickyHeight = 100;

                const scrollPosition = gridTop + timePosition - totalStickyHeight - 60;

                window.scrollTo({
                  top: Math.max(0, scrollPosition),
                  behavior: 'smooth'
                });
              }}
              className="hidden sm:block bg-white text-black px-3 sm:px-4 py-1.5 rounded-lg text-sm font-semibold hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(255,255,255,0.2)] transition-all cursor-pointer"
            >
              Browse DJ Shows
            </button>
            <a
              href="#get-involved"
              className="hidden sm:inline-block text-gray-400 hover:text-white text-sm transition-colors"
            >
              Get Involved
            </a>
            <Link
              href="/apply"
              className="hidden sm:inline-block text-gray-400 hover:text-white text-sm transition-colors"
            >
              Feature Your Station
            </Link>

            {/* User menu - visible on all screens */}
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

            {/* Mobile hamburger menu */}
            <MobileMenu
              items={[
                { label: "Get Involved", href: "#get-involved" },
                { label: "Feature Your Station", href: "/apply" },
              ]}
              onSignInClick={() => setShowAuthModal(true)}
            />
          </div>
        </div>
      </header>

      {/* Search bar section - sticky until scrolled past current time */}
      <div className={`${isSearchBarSticky ? 'sticky top-[52px] z-[45]' : ''} px-4 py-3 bg-black border-b border-gray-900`}>
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

      {/* Calendar Grid */}
      <main>
        <CalendarGrid searchQuery={searchQuery} onClearSearch={handleClearSearch} isSearchBarSticky={isSearchBarSticky} />
      </main>

      {/* Get Involved Section */}
      <section id="get-involved" className="py-16 px-6 bg-[#1a1a1a]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-8 text-center">
            Get Involved
          </h2>

          <div className="space-y-6 text-gray-400 leading-relaxed">
            <p>
              My name is Cap. I&apos;m building Channel out of love for DJ radio and the communities that make it so special.
            </p>

            <p>
              After moving from Paris to New York to Los Angeles, I realized how hard it was to stay connected with my favorite DJs, dancers, and curators beyond the dancefloor. This ecosystem deserves better tools: to support artists, strengthen communities, and make it easier to follow the sounds and the people you love.
            </p>

            <p>
              I&apos;m looking to connect with <span className="text-white">DJs, radio operators, nightlife promoters, dancers, and music heads</span> of all kinds. Whether you want to collaborate, give feedback, or just chat, I&apos;d truly love to hear from you.
            </p>

            <p>
              Channel is growing, and I&apos;m actively seeking help with:
            </p>

            <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
              <li>Fundraising</li>
              <li>Product & website design</li>
              <li>DJ & radio monetization strategy</li>
              <li>Marketing & community building</li>
              <li>Partnerships & licensing</li>
            </ul>

            <p>
              If any of this resonates, reach out. I&apos;d love to connect.
            </p>
          </div>

          <div className="mt-10 text-center">
            <a
              href="mailto:info@channel-app.com"
              className="inline-block bg-white text-black px-10 py-4 rounded-xl text-lg font-semibold hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(255,255,255,0.15)] transition-all"
            >
              Contact Us
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-6 bg-black">
        <div className="max-w-3xl mx-auto text-center">
          <div className="text-sm text-gray-600 space-y-3">
            <p>
              <Link href="/privacy" className="text-gray-500 hover:text-white transition-colors">
                Privacy Policy
              </Link>
              <span className="text-gray-700 mx-3">·</span>
              <Link href="/terms" className="text-gray-500 hover:text-white transition-colors">
                Terms & Conditions
              </Link>
              <span className="text-gray-700 mx-3">·</span>
              <Link href="/guidelines" className="text-gray-500 hover:text-white transition-colors">
                Community Guidelines
              </Link>
            </p>
            <p>&copy; 2025 Channel Media, Inc. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Browsing Mode Popup */}
      {showNowPlaying && (
        <BrowsingModePopup onClose={() => setShowNowPlaying(false)} />
      )}

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
    </BPMProvider>
  );
}
