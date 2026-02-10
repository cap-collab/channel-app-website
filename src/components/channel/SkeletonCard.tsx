export function SkeletonCard() {
  return (
    <div className="w-full flex flex-col h-full animate-pulse">
      {/* Match label placeholder */}
      <div className="flex items-center mb-1 h-4 px-0.5">
        <div className="h-2.5 w-24 bg-white/10 rounded" />
      </div>
      {/* 16:9 image placeholder */}
      <div className="relative w-full aspect-[16/9] overflow-hidden border border-white/10 bg-white/5" />
      {/* Text info placeholder */}
      <div className="flex flex-col py-2 gap-1.5">
        <div className="h-3.5 w-3/4 bg-white/10 rounded" />
        <div className="h-2.5 w-1/2 bg-white/10 rounded" />
      </div>
      {/* Button placeholders */}
      <div className="flex gap-2 mt-auto">
        <div className="flex-1 h-9 bg-white/10 rounded" />
        <div className="flex-1 h-9 bg-white/10 rounded" />
      </div>
    </div>
  );
}
