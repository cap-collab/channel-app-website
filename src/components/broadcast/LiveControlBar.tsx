'use client';

import { useAudioHealth } from '@/hooks/useAudioHealth';
import { AudioInputMethod } from '@/types/broadcast';
import { buildChecklist, isChecklistAllGreen } from '@/lib/broadcast-checklist';

interface LiveControlBarProps {
  stream: MediaStream | null;
  isLive: boolean;
  isRecordingMode?: boolean;
  inputMethod: AudioInputMethod | null;
  // Kept for prop compatibility with parent (unused here)
  showStartTime?: number;
  showName?: string;
  chatUsernameNormalized?: string;
}

type HealthBadge = 'OK' | 'MONITOR' | 'FIX';

// Health badge reflects live audio health:
// - FIX: both channels silent while stream exists, or severe dropouts (≥8/min).
// - MONITOR: sustained dropouts (≥3/min). Single blips shouldn't alarm.
// - OK: otherwise. Weak signal alone is NOT monitor — the checklist warns about that.
// No-stream state (before source selection) returns OK and is visually handled by
// the READY pill color.
function computeHealth(
  leftState: 'active' | 'weak' | 'silent',
  rightState: 'active' | 'weak' | 'silent',
  recentDropouts: number,
  hasStream: boolean,
): HealthBadge {
  if (!hasStream) return 'OK';
  const bothSilent = leftState === 'silent' && rightState === 'silent';
  if (bothSilent || recentDropouts >= 8) return 'FIX';
  if (recentDropouts >= 3) return 'MONITOR';
  return 'OK';
}

// Map dB to 0-1 for bar width: -60 → 0, 0 → 1
function dbToBarWidth(db: number): number {
  if (db <= -60) return 0;
  if (db >= 0) return 1;
  return (db + 60) / 60;
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
  isRecordingMode = false,
  inputMethod,
}: LiveControlBarProps) {
  const health = useAudioHealth(stream);

  const hasStream = !!stream;
  const hasStrongAudio = health.leftState === 'active' || health.rightState === 'active';
  const checklist = buildChecklist({ inputMethod, hasStream, hasStrongAudio });
  const allGreen = isChecklistAllGreen(checklist);

  const badge = computeHealth(health.leftState, health.rightState, health.recentDropouts, hasStream);

  const badgeStyle =
    badge === 'OK'
      ? 'bg-green-600 text-white'
      : badge === 'MONITOR'
        ? 'bg-yellow-500 text-black'
        : 'bg-red-600 text-white';

  // READY pill (pre-live) mirrors the checklist outcome so the DJ knows at a
  // glance whether setup is good before they click GO LIVE.
  // LIVE / RECORDING pill (post-live) stays red.
  const statusLabel = isLive
    ? (isRecordingMode ? 'RECORDING' : 'LIVE')
    : (allGreen ? 'READY' : 'NEEDS REVIEW');
  const statusPillStyle = isLive
    ? 'bg-red-600'
    : (allGreen ? 'bg-green-600' : 'bg-orange-500');

  // Audio-too-low warning — sustained severe undershoot on both channels.
  // We show this only when the stream exists and the loudest channel is
  // persistently below -40 dB (i.e. signal is so weak it's barely above noise).
  // The warning slot keeps reserved height so the layout never jumps.
  const peak = Math.max(health.leftPeakDb, health.rightPeakDb);
  const audioTooLow = hasStream && peak > -90 && peak < -40;

  return (
    <div className="sticky top-0 z-30 bg-[#141414] border-b border-gray-800 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-4 py-2.5">
        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-3 md:gap-5 items-center">
          {/* Left: status pill only — timer and show name live in the Audio System panel */}
          <div className="flex items-center gap-3 min-w-0">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full flex-shrink-0 ${statusPillStyle}`}>
              <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-white animate-pulse' : 'bg-white/70'}`} />
              <span className="text-white font-bold text-xs tracking-wider">{statusLabel}</span>
            </div>
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
                health.recentDropouts < 3 ? 'text-green-400' :
                health.recentDropouts < 8 ? 'text-yellow-400' : 'text-red-400'
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

        {/* Reserved warning slot — keeps height even when empty so layout doesn't
            jump when warnings come and go. */}
        <div className="mt-2 h-6 flex items-center">
          {audioTooLow && (
            <div className="text-xs text-orange-300 font-medium">
              ⚠ Audio levels are very low — check your mixer output or gain staging
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
