// Pinned banner showing the live DJ's show vibe verbatim, at the top of chat.
export function VibeBanner({ vibe }: { vibe: string }) {
  return (
    <div className="px-4 py-2 border-b border-white/10 bg-white/[0.03]">
      <p className="text-sm text-white">{vibe}</p>
    </div>
  );
}
