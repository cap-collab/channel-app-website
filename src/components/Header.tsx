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

const InstagramIcon = ({ size = 16, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
  </svg>
);

export function Header({ currentPage = "home", position = "fixed" }: HeaderProps) {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { user, isAuthenticated } = useAuthContext();
  const { role } = useUserRole(user);

  // Build menu items - now used for both mobile hamburger and desktop dropdown
  const getMenuItems = (): MobileMenuItem[] => {
    const items: MobileMenuItem[] = [];

    // Home - always first
    items.push({ label: "Home", href: "/", active: currentPage === "channel" });

    // Instagram - mobile-only menu entry; on desktop the icon sits next to the logo
    items.push({
      label: "IG",
      href: "https://instagram.com/channelrad.io",
      external: true,
      icon: <InstagramIcon size={16} />,
      mobileOnly: true,
    });

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
              href="/"
              className="flex-shrink-0 cursor-pointer relative z-[1000]"
              style={{ pointerEvents: 'auto' }}
            >
              <Image
                src="/logo-white.png"
                alt="CHANNEL"
                width={400}
                height={80}
                className="h-6 w-auto"
                priority
              />
            </Link>
            <a
              href="https://instagram.com/channelrad.io"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Channel on Instagram"
              className="hidden md:flex h-6 items-center text-gray-400 hover:text-white transition-colors relative z-[1000]"
              style={{ pointerEvents: 'auto' }}
            >
              {/* logo-white.png has 7px top / 15px bottom transparent padding, so the
                  letterforms' optical centre sits ~1px above the icon's flex centre */}
              <InstagramIcon size={18} className="-translate-y-px" />
            </a>
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
