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
  // Mobile: single banner shows the bridge attribution directly ("Similar
  // to {bridge}") when there's one, otherwise just "Suggested". No second
  // caption line — keeps the chrome to a single bar above the image.
  // Desktop: unchanged — "Suggested" on the left, "Similar to {bridge}"
  // on the right (justify-between).
  const justify = hasBridge ? 'justify-center md:justify-between' : 'justify-center';
  return (
    <div
      className={`bg-black text-white text-[9px] font-mono uppercase tracking-[0.35em] py-0.5 px-2 flex items-center gap-2 whitespace-nowrap ${justify}`}
    >
      {/* Mobile-only label: "Similar to {bridge}" when present, else "Suggested" */}
      {hasBridge ? (
        <>
          <span className="md:hidden truncate normal-case tracking-normal text-[10px]">
            Similar to {bridgeDjName}
          </span>
          <span className="hidden md:inline">Suggested</span>
          <span className="text-white/60 truncate normal-case tracking-normal hidden md:inline text-[10px]">
            Similar to {bridgeDjName}
          </span>
        </>
      ) : (
        <span>Suggested</span>
      )}
    </div>
  );
}

// Legacy bridge caption renderer — kept exported for back-compat with
// existing imports, but now renders nothing. The mobile bridge label is
// folded into the SuggestedBanner above so we never stack two bars.
export function SuggestedBridgeOverlay(): null {
  return null;
}

// Back-compat: existing call sites importing `SuggestedCardBadge` get the
// banner. (Cards that want both render `SuggestedBridgeOverlay` directly.)
export const SuggestedCardBadge = SuggestedBanner;
