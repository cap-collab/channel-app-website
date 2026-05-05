"use client";

import { forwardRef } from "react";

type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
};

/**
 * Cross-browser checkbox. The native input is visually hidden but keeps focus,
 * keyboard, and screen-reader behaviour; the visible box is a styled span so
 * the checked state looks identical on Safari/iOS where `accent-color` is
 * unreliable on dark backgrounds.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { checked, onChange, disabled, size = "md", className = "", ariaLabel },
  ref,
) {
  const dim = size === "sm" ? "w-4 h-4" : "w-5 h-5";
  const checkSize = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";

  return (
    <span className={`relative inline-flex flex-shrink-0 ${dim} ${className}`}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={`flex items-center justify-center w-full h-full rounded border transition-colors
          ${checked ? "bg-white border-white" : "bg-zinc-900 border-zinc-500"}
          ${disabled ? "opacity-50" : ""}
          peer-focus-visible:ring-2 peer-focus-visible:ring-white/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-black`}
      >
        {checked && (
          <svg
            className={`${checkSize} text-black`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8.5l3.2 3.2L13 4.5" />
          </svg>
        )}
      </span>
    </span>
  );
});
