// Suggested-card chrome.
// Desktop: banner shows "Suggested … Similar to {bridge}" inline (unchanged).
// Mobile: banner shows just "Suggested" centered, and the bridge attribution
// renders as a thin caption line BETWEEN the banner and the image.

interface BridgeProps {
  // Empty string = no bridge to attribute (e.g. empty-state Channel picks
  // for logged-out users / users with no engagement history). Banner stays
  // as "Suggested"; the caption is skipped.
  bridgeDjName: string;
}

export function SuggestedBanner({ bridgeDjName }: BridgeProps) {
  const hasBridge = !!bridgeDjName;
  // Mobile always centers. Desktop with a bridge uses justify-between to
  // keep the inline attribution on the right (legacy desktop behavior).
  const justify = hasBridge ? 'justify-center md:justify-between' : 'justify-center';
  return (
    <div
      className={`bg-black text-white text-[9px] font-mono uppercase tracking-[0.35em] py-0.5 px-2 flex items-center gap-2 whitespace-nowrap ${justify}`}
    >
      <span>Suggested</span>
      {hasBridge && (
        <span className="text-white/60 truncate normal-case tracking-normal hidden md:inline text-[10px]">
          Similar to {bridgeDjName}
        </span>
      )}
    </div>
  );
}

export function SuggestedBridgeOverlay({ bridgeDjName }: BridgeProps) {
  if (!bridgeDjName) return null;
  // Mobile-only caption line sitting between the SUGGESTED banner and the
  // image. Desktop is unchanged (the bridge appears inline in the banner).
  return (
    <div className="md:hidden bg-black/60 text-white/80 text-[10px] tracking-normal px-2 py-0.5 truncate text-center">
      Similar to {bridgeDjName}
    </div>
  );
}

// Back-compat: existing call sites importing `SuggestedCardBadge` get the
// banner. (Cards that want both render `SuggestedBridgeOverlay` directly.)
export const SuggestedCardBadge = SuggestedBanner;
