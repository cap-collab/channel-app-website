'use client';

interface BPMBadgeProps {
  bpm: number | null;
}

export function BPMBadge({ bpm }: BPMBadgeProps) {
  if (!bpm) return null;

  return (
    <div
      className="inline-flex items-center gap-1 px-2 h-6 rounded-full"
      style={{
        background: 'rgba(255, 255, 255, 0.12)',
        boxShadow: 'inset 0 0 0 0.5px rgba(255, 255, 255, 0.1)',
      }}
      aria-label={`Tempo: ${bpm} beats per minute`}
    >
      {/* Waveform icon */}
      <svg
        className="w-3 h-3 text-white/70"
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d="M12 3v18M8 7v10M4 10v4M16 7v10M20 10v4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span className="text-[11px] font-medium text-white/70">
        {bpm} BPM
      </span>
    </div>
  );
}
