// Small sharp top-bar badge for "SUGGESTED" cards rendered on /scene.
// Layered absolutely above the card content, square corners, white-on-black.

interface SuggestedCardBadgeProps {
  bridgeDjName: string;
}

export function SuggestedCardBadge({ bridgeDjName }: SuggestedCardBadgeProps) {
  return (
    <div className="absolute top-0 left-0 right-0 z-10 bg-black text-white text-[10px] font-mono uppercase tracking-[0.18em] px-2 py-1 flex items-center justify-between gap-2">
      <span>Suggested</span>
      <span className="text-white/70 truncate normal-case tracking-normal">
        Similar to {bridgeDjName}
      </span>
    </div>
  );
}
