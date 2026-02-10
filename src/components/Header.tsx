"use client";

import { useState } from "react";
import Image from "next/image";
import { useAuthContext } from "@/contexts/AuthContext";
import { AuthModal } from "@/components/AuthModal";
import { MobileMenu, MobileMenuItem } from "@/components/MobileMenu";
import { HeaderSearch } from "@/components/HeaderSearch";
import { useBroadcastLiveStatus } from "@/hooks/useBroadcastLiveStatus";

type CurrentPage = "home" | "djshows" | "apply" | "broadcast-admin" | "channel" | "dj-portal" | "radio-portal" | "my-shows" | "streaming-guide" | "stripe-setup" | "studio" | "archives";

interface HeaderProps {
  currentPage?: CurrentPage;
  position?: "fixed" | "sticky";
  showSearch?: boolean;
}

export function Header({ currentPage = "home", position = "fixed", showSearch = true }: HeaderProps) {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { isAuthenticated } = useAuthContext();
  const { isLive } = useBroadcastLiveStatus();

  // Build menu items - now used for both mobile hamburger and desktop dropdown
  const getMenuItems = (): MobileMenuItem[] => {
    const items: MobileMenuItem[] = [];

    // Home/Live Now - always first
    if (isLive) {
      items.push({ label: "🔴 Live Now", href: "/channel", active: currentPage === "channel" });
    } else {
      items.push({ label: "Home", href: "/channel", active: currentPage === "channel" });
    }

    // DJ Studio link - only show when not signed in (signed-in users have it in the auth section)
    if (!isAuthenticated) {
      items.push({ label: "Studio", href: "/studio/join", active: currentPage === "studio" || currentPage === "dj-portal" });
    }

    // Always show auth option in menu
    items.push({ type: "auth" });

    return items;
  };

  const positionClass = position === "fixed"
    ? "fixed top-0 left-0 right-0"
    : "sticky top-0";

  return (
    <>
      <header className={`${positionClass} z-[100] bg-black/80 backdrop-blur-md border-b border-gray-900 isolate`}>
        <div className="px-4 py-3 flex items-center justify-between">
          {/* Left side: Logo */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                console.log('[Header] Logo clicked!');
                window.location.href = "/channel";
              }}
              className="flex-shrink-0 cursor-pointer relative z-[1000]"
              style={{ pointerEvents: 'auto' }}
            >
              <Image
                src="/logo-white.svg"
                alt="CHANNEL"
                width={120}
                height={24}
                className="h-6 w-auto"
                priority
              />
            </button>
          </div>

          {/* Center: Search bar - always visible, inline with logo */}
          {showSearch && (
            <div className="flex-1 mx-3 max-w-md">
              <HeaderSearch onAuthRequired={() => setShowAuthModal(true)} />
            </div>
          )}

          {/* Right side: Menu button */}
          <div className="flex items-center">
            <MobileMenu
              items={getMenuItems()}
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
