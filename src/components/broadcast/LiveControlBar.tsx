'use client';

import { useEffect, useState } from 'react';
import { useAudioHealth } from '@/hooks/useAudioHealth';

interface LiveControlBarProps {
  stream: MediaStream | null;
  isLive: boolean;
  showStartTime?: number;
  showName?: string;
  isRecordingMode?: boolean;
  // Kept for prop compatibility with parent
  chatUsernameNormalized?: string;
}

type HealthBadge = 'OK' | 'MONITOR' | 'FIX';

function computeHealth(
  leftState: 'active' | 'weak' | 'silent',
  rightState: 'active' | 'weak' | 'silent',
  recentDropouts: number,
): HealthBadge {
  const bothSilent = leftState === 'silent' && rightState === 'silent';
  const oneSilent = leftState === 'silent' || rightState === 'silent';

  if (bothSilent || recentDropouts >= 4) return 'FIX';
  if (oneSilent || recentDropouts >= 1 || leftState === 'weak' || rightState === 'weak') {
    return 'MONITOR';
  }
  return 'OK';
}

// Map dB to 0-1 for bar width: -60 → 0, 0 → 1
function dbToBarWidth(db: number): number {
  if (db <= -60) return 0;
  if (db >= 0) return 1;
  return (db + 60) / 60;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function ChannelMeter({ label, db }: { label: 'L' | 'R'; db: number }) {
  const width = Math.round(dbToBarWidth(db) * 100);
  // Segment coloring: red at top, yellow mid, green bottom — but we render as a
  // single gradient bar since peaks traverse all zones.
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[10px] text-gray-500 font-mono w-3 text-right">{label}</span>
      <div className="relative h-3 bg-gray-900 rounded-sm overflow-hidden flex-1 min-w-0 border border-gray-800">
        {/* dB reference marks */}
        <div className="absolute inset-y-0" style={{ left: '66%', width: 1 }}>
          <div className="h-full bg-gray-700/60" />
        </div>
        <div className="absolute inset-y-0" style={{ left: '83%', width: 1 }}>
          <div className="h-full bg-red-500/30" />
        </div>
        {/* Fill */}
        <div
          className="absolute inset-y-0 left-0 transition-all duration-75"
          style={{
            width: `${width}%`,
            background:
              'linear-gradient(to right, #22c55e 0%, #22c55e 60%, #eab308 75%, #ef4444 95%)',
          }}
        />
      </div>
      <span className="text-[10px] text-gray-500 font-mono tabular-nums w-10 text-right">
        {db > -99 ? Math.round(db) : '−∞'}
      </span>
    </div>
  );
}

export function LiveControlBar({
  stream,
  isLive,
  showStartTime,
  showName,
  isRecordingMode = false,
}: LiveControlBarProps) {
  const health = useAudioHealth(stream);

  // Rolling timer for elapsed time since live
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  const elapsedMs = isLive && showStartTime ? nowMs - showStartTime : 0;
  const badge = computeHealth(health.leftState, health.rightState, health.recentDropouts);

  const badgeStyle =
    badge === 'OK'
      ? 'bg-green-600 text-white'
      : badge === 'MONITOR'
        ? 'bg-yellow-500 text-black'
        : 'bg-red-600 text-white';

  const statusLabel = isLive ? (isRecordingMode ? 'RECORDING' : 'LIVE') : 'READY';
  const statusPillStyle = isLive ? 'bg-red-600' : 'bg-gray-700';

  return (
    <div className="sticky top-0 z-30 bg-[#141414] border-b border-gray-800 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-4 py-2.5">
        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-3 md:gap-5 items-center">
          {/* Left: status pill + show + timer */}
          <div className="flex items-center gap-3 min-w-0">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full flex-shrink-0 ${statusPillStyle}`}>
              <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-white animate-pulse' : 'bg-gray-400'}`} />
              <span className="text-white font-bold text-xs tracking-wider">{statusLabel}</span>
            </div>
            {isLive && (
              <span className="text-white font-mono tabular-nums text-sm flex-shrink-0">
                {formatDuration(elapsedMs)}
              </span>
            )}
            {showName && (
              <span className="text-gray-400 text-sm truncate min-w-0 hidden sm:inline">
                {showName}
              </span>
            )}
          </div>

          {/* Middle: L/R meters */}
          <div className="space-y-1 min-w-0">
            <ChannelMeter label="L" db={health.leftPeakDb} />
            <ChannelMeter label="R" db={health.rightPeakDb} />
          </div>

          {/* Right: health + dropouts */}
          <div className="flex items-center gap-3 flex-shrink-0 justify-self-end">
            <div className="text-right">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Dropouts / min</div>
              <div className={`text-sm font-mono tabular-nums ${
                health.recentDropouts === 0 ? 'text-green-400' :
                health.recentDropouts < 4 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {health.recentDropouts}
                {isLive && health.totalDropouts > 0 && (
                  <span className="text-[10px] text-gray-500 ml-1">({health.totalDropouts} total)</span>
                )}
              </div>
            </div>
            <div className={`px-2.5 py-1 rounded font-bold text-xs tracking-wider ${badgeStyle}`}>
              {badge}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
