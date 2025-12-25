'use client';

interface ProgressBarProps {
  progress: number; // 0 to 1
}

export function ProgressBar({ progress }: ProgressBarProps) {
  const percentage = Math.min(Math.max(progress * 100, 0), 100);

  return (
    <div className="h-1 bg-gray-800">
      <div
        className="h-full bg-gradient-to-r from-accent/60 to-accent transition-all duration-1000"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
