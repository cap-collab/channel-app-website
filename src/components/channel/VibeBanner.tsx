// Pinned show-vibe message at the top of chat. Rendered in the same format as
// a DJ chat message (name + red dot + text) with a lighter highlight bg so it
// reads as a real, pinned message rather than a faint banner.
export function VibeBanner({ vibe, djName }: { vibe: string; djName?: string | null }) {
  return (
    <div className="py-1.5 px-4 bg-white/[0.07] border-b border-white/10">
      <p className="min-w-0">
        <span className="font-medium text-white">{djName || 'DJ'}</span>
        <span className="inline-block w-2 h-2 bg-red-500 rounded-full ml-1 align-middle" title="DJ" />
        <span className="text-white ml-1.5">{vibe}</span>
      </p>
    </div>
  );
}
