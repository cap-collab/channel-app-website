'use client';

interface RecordingQuota {
  monthKey: string;
  usedSeconds: number;
  maxSeconds: number;
  remainingSeconds: number;
  canRecord: boolean;
}

interface QuotaDisplayProps {
  quota: RecordingQuota;
  showMonthLabel?: boolean;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h`;
  } else {
    return `${minutes}m`;
  }
}

function getMonthName(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function QuotaDisplay({ quota, showMonthLabel = true }: QuotaDisplayProps) {
  const usedPercentage = Math.min(100, (quota.usedSeconds / quota.maxSeconds) * 100);
  const remainingMinutes = Math.floor(quota.remainingSeconds / 60);

  // Color based on remaining quota
  let barColor = 'bg-green-500';
  let textColor = 'text-green-400';
  if (quota.remainingSeconds <= 0) {
    barColor = 'bg-red-500';
    textColor = 'text-red-400';
  } else if (quota.remainingSeconds < 30 * 60) {
    // Less than 30 minutes
    barColor = 'bg-yellow-500';
    textColor = 'text-yellow-400';
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 mb-6">
      {showMonthLabel && (
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-400 text-sm">{getMonthName(quota.monthKey)}</span>
          <span className={`text-sm font-medium ${textColor}`}>
            {formatDuration(quota.remainingSeconds)} remaining
          </span>
        </div>
      )}

      {/* Progress bar */}
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${usedPercentage}%` }}
        />
      </div>

      <div className="flex justify-between text-xs text-gray-500">
        <span>Used: {formatDuration(quota.usedSeconds)}</span>
        <span>Total: {formatDuration(quota.maxSeconds)}</span>
      </div>

      {!quota.canRecord && (
        <div className="mt-3 bg-red-900/30 border border-red-900 rounded-lg px-3 py-2">
          <p className="text-red-300 text-sm">
            You&apos;ve used all your recording time for this month. Your quota resets at the start of next month.
          </p>
        </div>
      )}

      {quota.canRecord && remainingMinutes <= 30 && remainingMinutes > 0 && (
        <div className="mt-3 bg-yellow-900/30 border border-yellow-900 rounded-lg px-3 py-2">
          <p className="text-yellow-300 text-sm">
            You have {remainingMinutes} minutes of recording time remaining this month.
          </p>
        </div>
      )}
    </div>
  );
}
