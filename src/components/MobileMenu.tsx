"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuthContext } from "@/contexts/AuthContext";

export type MobileMenuItem =
  | { label: string; href?: string; onClick?: () => void; type?: "link"; external?: boolean }
  | { type: "auth"; label?: never; href?: never; onClick?: never; external?: never };

interface MobileMenuProps {
  items: MobileMenuItem[];
  onSignInClick?: () => void;
}

export function MobileMenu({ items, onSignInClick }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { user, isAuthenticated, signOut, loading } = useAuthContext();

  const handleItemClick = (item: MobileMenuItem) => {
    if (item.onClick) {
      item.onClick();
    }
    setIsOpen(false);
  };

  return (
    <div className="relative sm:hidden">
      {/* Hamburger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
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
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu */}
          <div className="absolute right-0 top-12 z-50 bg-black border border-gray-800 rounded-lg py-1 min-w-[180px]">
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
                      <div className="px-4 py-2 border-b border-gray-800">
                        <p className="text-white text-sm font-medium truncate">
                          {user.displayName || user.email?.split("@")[0]}
                        </p>
                        <p className="text-gray-500 text-xs truncate">
                          {user.email}
                        </p>
                      </div>
                      <Link
                        href="/my-shows"
                        onClick={() => setIsOpen(false)}
                        className="block w-full px-4 py-3 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                      >
                        My Shows
                      </Link>
                      <Link
                        href="/settings"
                        onClick={() => setIsOpen(false)}
                        className="block w-full px-4 py-3 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                      >
                        Settings
                      </Link>
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
                      className="block w-full px-4 py-3 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                    >
                      {item.label}
                    </a>
                  );
                }
                return (
                  <Link
                    key={index}
                    href={item.href}
                    onClick={() => handleItemClick(item)}
                    className="block w-full px-4 py-3 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                  >
                    {item.label}
                  </Link>
                );
              }

              return (
                <button
                  key={index}
                  onClick={() => handleItemClick(item)}
                  className="w-full px-4 py-3 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
