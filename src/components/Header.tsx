"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUserRole, isDJ } from "@/hooks/useUserRole";
import { AuthModal } from "@/components/AuthModal";
import { MobileMenu, MobileMenuItem } from "@/components/MobileMenu";
import { HeaderTuner } from "@/components/HeaderTuner";
import { GlobalBroadcastBar } from "@/components/GlobalBroadcastBar";
import { FloatingChat } from "@/components/channel/FloatingChat";

type CurrentPage = "home" | "djshows" | "apply" | "broadcast-admin" | "channel" | "dj-portal" | "radio-portal" | "my-shows" | "streaming-guide" | "stripe-setup" | "studio" | "archives" | "explore";

interface HeaderProps {
  currentPage?: CurrentPage;
  position?: "fixed" | "sticky";
}

export function Header({ currentPage = "home", position = "fixed" }: HeaderProps) {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { user, isAuthenticated } = useAuthContext();
  const { role } = useUserRole(user);

  // Build menu items - now used for both mobile hamburger and desktop dropdown
  const getMenuItems = (): MobileMenuItem[] => {
    const items: MobileMenuItem[] = [];

    // Home - always first
    items.push({ label: "Home", href: "/radio", active: currentPage === "channel" });

    // Explore - always shown
    items.push({ label: "Explore", href: "/explore", active: currentPage === "explore" });

    // Studio - shown when signed out or when user is a DJ
    if (!isAuthenticated || isDJ(role)) {
      items.push({ label: "Studio", href: "/studio", active: currentPage === "studio" || currentPage === "dj-portal" });
    }

    // Always show auth option in menu
    items.push({ type: "auth" });

    // About is always shown, last in menu
    items.push({ label: "About", href: "/about" });

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
            <Link
              href="/radio"
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
            </Link>
          </div>

          {/* Center: City/Genre filters */}
          <div className="flex-1 mx-3 max-w-md">
            <HeaderTuner />
          </div>

          {/* Right side: Menu button */}
          <div className="flex items-center">
            <MobileMenu
              items={getMenuItems()}
              onSignInClick={() => setShowAuthModal(true)}
            />
          </div>
        </div>
        <GlobalBroadcastBar />
      </header>

      <FloatingChat />

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}
