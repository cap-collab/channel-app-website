"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUserRole, isDJ } from "@/hooks/useUserRole";

export type MobileMenuItem =
  | { label: string; href?: string; onClick?: () => void; type?: "link"; external?: boolean; active?: boolean }
  | { type: "auth"; label?: never; href?: never; onClick?: never; external?: never; active?: never };

interface MobileMenuProps {
  items: MobileMenuItem[];
  onSignInClick?: () => void;
}

export function MobileMenu({ items, onSignInClick }: MobileMenuProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const { user, isAuthenticated, signOut, loading } = useAuthContext();
  const { role } = useUserRole(user);

  const handleItemClick = (item: MobileMenuItem) => {
    if (item.onClick) {
      item.onClick();
    }
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* Hamburger button - now visible on all screen sizes */}
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
          {/* Backdrop - starts below header to not block header clicks */}
          <div
            className="fixed inset-0 top-[60px] z-[99]"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu - z-[200] to be above everything including backdrop */}
          <div className="fixed right-4 top-[60px] z-[200] bg-black border border-gray-800 rounded-lg py-1 min-w-[180px]">
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
                          console.log('[MobileMenu] My Favorites clicked!');
                          setIsOpen(false);
                          window.location.href = "/my-shows";
                        }}
                        className="block w-full px-4 py-3 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                        style={{ pointerEvents: 'auto' }}
                      >
                        My Favorites
                      </button>
                      <button
                        onClick={() => {
                          console.log('[MobileMenu] Inbox clicked!');
                          setIsOpen(false);
                          window.location.href = "/inbox";
                        }}
                        className="block w-full px-4 py-3 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                        style={{ pointerEvents: 'auto' }}
                      >
                        Inbox
                      </button>
                      {isDJ(role) && (
                        <button
                          onClick={() => {
                            console.log('[MobileMenu] DJ Profile clicked!');
                            setIsOpen(false);
                            window.location.href = "/studio";
                          }}
                          className="block w-full px-4 py-3 text-left text-sm text-gray-400 hover:text-white hover:bg-[#252525] transition-colors"
                          style={{ pointerEvents: 'auto' }}
                        >
                          DJ Profile
                        </button>
                      )}
                      <button
                        onClick={() => {
                          console.log('[MobileMenu] Settings clicked!');
                          setIsOpen(false);
                          window.location.href = "/settings";
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
                      className={`block w-full px-4 py-3 text-left text-sm ${textClass} hover:bg-[#252525] transition-colors`}
                    >
                      {item.label}
                    </a>
                  );
                }
                // Use button with window.location for internal links
                return (
                  <button
                    key={index}
                    onClick={() => {
                      console.log('[MobileMenu] Item clicked:', item.label);
                      handleItemClick(item);
                      window.location.href = item.href!;
                    }}
                    className={`block w-full px-4 py-3 text-left text-sm ${textClass} hover:bg-[#252525] transition-colors`}
                    style={{ pointerEvents: 'auto' }}
                  >
                    {item.label}
                  </button>
                );
              }

              return (
                <button
                  key={index}
                  onClick={() => handleItemClick(item)}
                  className={`w-full px-4 py-3 text-left text-sm ${textClass} hover:bg-[#252525] transition-colors`}
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
