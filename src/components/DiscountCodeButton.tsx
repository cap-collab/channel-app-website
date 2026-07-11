"use client";

import { useState, useCallback } from "react";

// Compact inline discount-code pill for event cards + "Coming up" rows.
//   1. 2-line "DISCOUNT CODE"                       — default
//   2. tap (logged in) → reveals the code in place
//   3. tap the code    → copies it ("copied!"), hint stays non-bold
// Logged out → onRequireAuth() (opens the app sign-in modal).
// Renders nothing when there's no code.

interface Props {
  code: string | null | undefined;
  isAuthenticated: boolean;
  onRequireAuth: () => void;
}

export function DiscountCodeButton({ code, isAuthenticated, onRequireAuth }: Props) {
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

  // Default (not revealed): compact rounded pill with a 2-line "DISCOUNT CODE".
  // Revealed: the code itself, with a lighter "click to copy" hint (not bold).
  if (!revealed) {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label="Discount code"
        title="Discount code"
        className="inline-flex items-center justify-center leading-none px-3 py-1.5 rounded-full border border-green-500 text-white text-[10px] font-semibold uppercase tracking-wide bg-white/5 hover:bg-white/15 transition-colors"
      >
        Discount
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex flex-col items-center justify-center leading-tight px-3 py-1.5 rounded-full border border-green-500 text-white bg-white/5 hover:bg-white/15 transition-colors"
    >
      <span className="text-sm font-semibold">{code}</span>
      <span className="text-[10px] text-white/60 font-normal">{copied ? "copied!" : "click to copy"}</span>
    </button>
  );
}
