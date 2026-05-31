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
  const hasBridge = !!bridgeDjName;
  // When there's no bridge, center the "S U G G E S T E D" label at all
  // breakpoints. When there IS a bridge, mobile centers (the bridge name
  // shows as a card overlay instead) and desktop uses justify-between to
  // push the attribution to the right.
  const justify = hasBridge ? 'justify-center md:justify-between' : 'justify-center';
  return (
    <div
      className={`bg-black text-white text-[9px] font-mono uppercase tracking-[0.35em] py-0.5 px-2 flex items-center gap-2 whitespace-nowrap ${justify}`}
    >
      <span className="whitespace-nowrap">Suggested</span>
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
  // Sit slightly above center so the pill doesn't crash into the DJ name
  // at the bottom of the card or any badge at the top.
  return (
    <div className="md:hidden absolute inset-x-0 top-1/3 z-10 flex justify-center pointer-events-none">
      <span className="bg-black/40 text-white text-[10px] font-medium px-2 py-1 backdrop-blur-sm">
        Similar to {bridgeDjName}
      </span>
    </div>
  );
}

// Back-compat: existing call sites importing `SuggestedCardBadge` get the
// banner. (Cards that want both render `SuggestedBridgeOverlay` directly.)
export const SuggestedCardBadge = SuggestedBanner;
