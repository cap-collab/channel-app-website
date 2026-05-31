// Two pieces of suggested-card chrome:
// - SuggestedBanner: full-width black strip ABOVE the card image, says
//   "SUGGESTED" on the left and "Similar to {bridge}" on the right.
//   The bridge name is hidden on mobile and shown as a centered overlay
//   on the image instead (SuggestedBridgeOverlay).
// - SuggestedBridgeOverlay: small pill centered on the card image,
//   visible only on mobile, naming the bridge DJ.

interface BridgeProps {
  // Empty string = no bridge to attribute (e.g. empty-state Channel picks
  // for logged-out users / users with no engagement history). The banner
  // still renders as "Suggested" but skips the "Similar to" attribution
  // and the centered mobile overlay.
  bridgeDjName: string;
}

export function SuggestedBanner({ bridgeDjName }: BridgeProps) {
  return (
    <div className="bg-black text-white text-[10px] font-mono uppercase tracking-[0.18em] px-2 py-1 flex items-center justify-center md:justify-between gap-2 border border-white/10 border-b-0">
      <span>Suggested</span>
      {bridgeDjName && (
        <span className="text-white/70 truncate normal-case tracking-normal hidden md:inline">
          Similar to {bridgeDjName}
        </span>
      )}
    </div>
  );
}

export function SuggestedBridgeOverlay({ bridgeDjName }: BridgeProps) {
  if (!bridgeDjName) return null;
  return (
    <div className="md:hidden absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
      <span className="bg-black/40 text-white text-[10px] font-medium px-2 py-1 backdrop-blur-sm">
        Similar to {bridgeDjName}
      </span>
    </div>
  );
}

// Back-compat: existing call sites importing `SuggestedCardBadge` get the
// banner. (Cards that want both render `SuggestedBridgeOverlay` directly.)
export const SuggestedCardBadge = SuggestedBanner;
