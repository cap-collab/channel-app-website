// Suggested-card chrome.
// Desktop: banner shows "Suggested … Similar to {bridge}" inline (unchanged).
// Mobile: banner shows just "Suggested" centered, and the bridge attribution
// renders as a thin caption line BETWEEN the banner and the image.

export type SuggestionKind = 'crew' | 'audience';

interface BridgeProps {
  // Empty string = no bridge to attribute (e.g. empty-state Channel picks
  // for logged-out users / users with no engagement history). Banner stays
  // as "Suggested"; the caption is skipped.
  bridgeDjName: string;
  // 'crew' = shared crew with the bridge DJ → "Affiliated with {bridge}"
  // 'audience' (default) = shared audience → "Similar to {bridge}"
  kind?: SuggestionKind;
}

export function SuggestedBanner({ bridgeDjName, kind = 'audience' }: BridgeProps) {
  const hasBridge = !!bridgeDjName;
  const label = kind === 'crew' ? `Affiliated with ${bridgeDjName}` : `Similar to ${bridgeDjName}`;
  // Mobile: single banner shows the bridge attribution directly when there's
  // one, otherwise just "Suggested". No second caption line — keeps the
  // chrome to a single bar above the image. Desktop: "Suggested" on the
  // left, attribution on the right (justify-between).
  const justify = hasBridge ? 'justify-center md:justify-between' : 'justify-center';
  return (
    <div
      className={`bg-black text-white text-[9px] font-mono uppercase tracking-[0.35em] py-0.5 px-2 flex items-center gap-2 whitespace-nowrap ${justify}`}
    >
      {hasBridge ? (
        <>
          <span className="md:hidden truncate normal-case tracking-normal text-[10px]">
            {label}
          </span>
          <span className="hidden md:inline">Suggested</span>
          <span className="text-white/60 truncate normal-case tracking-normal hidden md:inline text-[10px]">
            {label}
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
