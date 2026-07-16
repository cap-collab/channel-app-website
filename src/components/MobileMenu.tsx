"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/contexts/AuthContext";


export type MobileMenuItem =
  | { label: string; href?: string; onClick?: () => void; type?: "link"; external?: boolean; active?: boolean; icon?: React.ReactNode; mobileOnly?: boolean }
  | { type: "auth"; label?: never; href?: never; onClick?: never; external?: never; active?: never; icon?: never; mobileOnly?: never };

interface MobileMenuProps {
  items: MobileMenuItem[];
  onSignInClick?: () => void;
}

export function MobileMenu({ items, onSignInClick }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Menu/backdrop anchor to the actual bottom of the header, which grows when
  // the broadcast bar is showing — a fixed top-[60px] gets covered by it.
  const [headerBottom, setHeaderBottom] = useState(60);
  const router = useRouter();
  const { user, isAuthenticated, signOut, loading } = useAuthContext();

  // Measure the header's bottom edge whenever the menu opens (header height
  // varies with the broadcast bar). Re-measure on resize while open.
  useEffect(() => {
    if (!isOpen) return;
    const measure = () => {
      const header = document.querySelector("header");
      if (header) setHeaderBottom(Math.round(header.getBoundingClientRect().bottom));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isOpen]);

  const handleItemClick = (item: MobileMenuItem) => {
    if (item.onClick) {
      item.onClick();
    }
    setIsOpen(false);
  };

  // Listen for 'closemenu' events from other components (e.g. Tuner dropdowns)
  useEffect(() => {
    const handleCloseMenu = () => setIsOpen(false);
    document.addEventListener('closemenu', handleCloseMenu);
    return () => document.removeEventListener('closemenu', handleCloseMenu);
  }, []);

  return (
    <div className="relative">
      {/* Hamburger button - now visible on all screen sizes */}
      <button
        onClick={() => {
          const opening = !isOpen;
          setIsOpen(opening);
          if (opening) document.dispatchEvent(new CustomEvent('closetuner'));
        }}
        className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        aria-label="Menu"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <>
          {/* Backdrop - starts below header to not block header clicks */}
          <div
            className="fixed inset-x-0 bottom-0 z-[99]"
            style={{ top: headerBottom }}
            onClick={() => setIsOpen(false)}
          />

          {/* Menu - z-[200] to be above everything including backdrop */}
          <div
            className="fixed right-4 z-[200] bg-black border border-gray-800 rounded-lg py-1 min-w-[180px]"
            style={{ top: headerBottom }}
          >
            {items.map((item, index) => {
              // Handle auth item specially
              if (item.type === "auth") {
                if (loading) {
                  return (
                    <div key={index} className="px-4 py-3">
                      <div className="w-full h-4 bg-gray-800 rounded animate-pulse" />
                    </div>
                  );
                }

                if (isAuthenticated && user) {
                  return (
                    <div key={index}>
                      <button
                        onClick={() => {
                          setIsOpen(false);
                          router.push("/settings");
                        }}
                        className="block w-full px-4 py-3 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                        style={{ pointerEvents: 'auto' }}
                      >
                        Settings
                      </button>
                      <button
                        onClick={() => {
                          signOut();
                          setIsOpen(false);
                        }}
                        className="w-full px-4 py-3 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                      >
                        Sign Out
                      </button>
                    </div>
                  );
                }

                // Not authenticated - show Sign In
                return (
                  <button
                    key={index}
                    onClick={() => {
                      onSignInClick?.();
                      setIsOpen(false);
                    }}
                    className="w-full px-4 py-3 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                  >
                    Sign In
                  </button>
                );
              }

              // Regular link or button item
              const textClass = item.active
                ? "text-white"
                : "text-gray-400 hover:text-white";

              const labelContent = item.icon ? (
                <span className="inline-flex items-center gap-2">
                  {item.icon}
                  {item.label}
                </span>
              ) : (
                item.label
              );
              const visibilityClass = item.mobileOnly ? "md:hidden" : "";

              if (item.href) {
                const isAnchor = item.href.startsWith("#");
                const isExternal = item.external || item.href.startsWith("http");
                if (isAnchor || isExternal) {
                  return (
                    <a
                      key={index}
                      href={item.href}
                      onClick={() => handleItemClick(item)}
                      target={isExternal ? "_blank" : undefined}
                      rel={isExternal ? "noopener noreferrer" : undefined}
                      className={`block w-full px-4 py-3 text-left text-sm ${textClass} hover:bg-[#252525] transition-colors ${visibilityClass}`}
                    >
                      {labelContent}
                    </a>
                  );
                }
                // Use button with router.push for internal links
                return (
                  <button
                    key={index}
                    onClick={() => {
                      handleItemClick(item);
                      router.push(item.href!);
                    }}
                    className={`block w-full px-4 py-3 text-left text-sm ${textClass} hover:bg-[#252525] transition-colors ${visibilityClass}`}
                    style={{ pointerEvents: 'auto' }}
                  >
                    {labelContent}
                  </button>
                );
              }

              return (
                <button
                  key={index}
                  onClick={() => handleItemClick(item)}
                  className={`w-full px-4 py-3 text-left text-sm ${textClass} hover:bg-[#252525] transition-colors ${visibilityClass}`}
                >
                  {labelContent}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
