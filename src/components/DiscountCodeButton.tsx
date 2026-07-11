"use client";

import { useState, useCallback } from "react";

// Discount-code button for event cards + "Coming up" rows. Three states:
//   1. "DISCOUNT CODE" (2-line label)  — default
//   2. tap (logged in) → reveals the code in place
//   3. tap the code    → copies it → "Copied!" briefly, then back to the code
// Logged out → onRequireAuth() (opens the app sign-in modal).
// Renders nothing when there's no code.

interface Props {
  code: string | null | undefined;
  isAuthenticated: boolean;
  onRequireAuth: () => void;
  // "full" = full-width stacked button (event cards); "chip" = compact square
  // to sit next to the ticket chip ("Coming up" rows).
  variant?: "full" | "chip";
}

export function DiscountCodeButton({ code, isAuthenticated, onRequireAuth, variant = "full" }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy discount code:", err);
    }
  }, [code]);

  if (!code) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) {
      onRequireAuth();
      return;
    }
    if (!revealed) {
      setRevealed(true);
      return;
    }
    copy();
  };

  if (variant === "chip") {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label="Discount code"
        title="Discount code"
        className="inline-flex items-center justify-center h-7 px-2 rounded-full border border-white/40 text-white text-[10px] font-semibold uppercase tracking-wide bg-white/5 hover:bg-white/15 backdrop-blur-md transition-colors"
      >
        {!revealed ? (
          <span className="leading-none">CODE</span>
        ) : copied ? (
          <span className="leading-none">Copied!</span>
        ) : (
          <span className="leading-none">{code}</span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full py-2 px-4 rounded-full border border-white/40 text-white text-xs font-semibold uppercase tracking-wide bg-white/5 hover:bg-white/15 transition-colors flex flex-col items-center justify-center leading-tight"
    >
      {!revealed ? (
        <>
          <span>Discount</span>
          <span>Code</span>
        </>
      ) : copied ? (
        <span className="normal-case tracking-normal text-sm">Copied!</span>
      ) : (
        <span className="normal-case tracking-normal text-sm">{code} · tap to copy</span>
      )}
    </button>
  );
}
