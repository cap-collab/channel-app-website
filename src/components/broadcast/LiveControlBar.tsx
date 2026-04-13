'use client';

import { useEffect, useRef, useState } from 'react';
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

// Meter scale: -60 dB → 0 dB linear. Zones map to broadcast practice:
//   -60 to -40 dB : gray   (noise floor — not useful signal)
//   -40 to -6  dB : green  (healthy level)
//   -6  to -3  dB : yellow (hot, near headroom ceiling)
//   -3  to  0  dB : red    (clipping)
// Fill semantics: the bar fills left→right as level rises. Whatever portion
// is filled takes the color of the zone the CURRENT level sits in. Reference
// ticks at -40 / -6 / -3 stay as faint marks on the track.
// Gradual color at a given dB level. Interpolates through:
//   below -50 dB : gray (no useful signal)
//   -50 → -10 dB : green (stable hue, healthy zone)
//   -10 → -3 dB  : green → yellow → orange (getting hot)
//   -3 → 0+ dB   : red (clipping)
function fillColorForDb(db: number): string {
  if (db < -50) return '#4b5563'; // gray
  if (db <= -10) return '#22c55e'; // green plateau
  if (db >= -3) return '#ef4444'; // red plateau
  // Between -10 and -3: interpolate hue from green (120°) through yellow (60°)
  // to red-orange (10°). At -10 → 120°, at -3 → 10°.
  const t = (db - -10) / (-3 - -10); // 0..1
  const hue = 120 - t * 110; // 120° → 10°
  return `hsl(${Math.round(hue)}, 85%, 50%)`;
}

function ChannelMeter({ label, db }: { label: 'L' | 'R'; db: number }) {
  const width = Math.round(dbToBarWidth(db) * 100);
  const fillColor = fillColorForDb(db);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[10px] text-gray-500 font-mono w-3 text-right">{label}</span>
      <div className="relative h-3 bg-gray-900 rounded-sm overflow-hidden flex-1 min-w-0 border border-gray-800">
        {/* Zone reference ticks (faint, fixed): -40, -6, -3 */}
        <div className="absolute inset-y-0 bg-gray-600/50" style={{ left: '33.3%', width: 1 }} />
        <div className="absolute inset-y-0 bg-yellow-500/30" style={{ left: '90%', width: 1 }} />
        <div className="absolute inset-y-0 bg-red-500/40" style={{ left: '95%', width: 1 }} />
        {/* Fill — solid color based on current level */}
        <div
          className="absolute inset-y-0 left-0 transition-all duration-75"
          style={{ width: `${width}%`, backgroundColor: fillColor }}
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

  // Audio-too-low warning — hysteresis-based so the message doesn't flicker
  // on every brief peak/dip. Must sustain below threshold for `enterMs` to
  // turn ON, and must sustain above it for `exitMs` to turn OFF.
  const peak = Math.max(health.leftPeakDb, health.rightPeakDb);
  const LOW_ENTER_DB = -40;   // must be below this for a while to trigger
  const LOW_EXIT_DB = -35;    // must be above this for a while to clear (5 dB gap)
  const LOW_ENTER_MS = 4000;  // sustained under-volume needed to alert
  const LOW_EXIT_MS = 2000;   // sustained proper volume needed to clear
  const [audioTooLow, setAudioTooLow] = useState(false);
  const lowSinceRef = useRef<number | null>(null);
  const okSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!hasStream || peak <= -90) {
      // No signal at all — don't show the "too low" warning (covered by checklist).
      setAudioTooLow(false);
      lowSinceRef.current = null;
      okSinceRef.current = null;
      return;
    }
    const now = performance.now();
    if (peak < LOW_ENTER_DB) {
      okSinceRef.current = null;
      if (lowSinceRef.current === null) lowSinceRef.current = now;
      if (!audioTooLow && now - lowSinceRef.current >= LOW_ENTER_MS) {
        setAudioTooLow(true);
      }
    } else if (peak > LOW_EXIT_DB) {
      lowSinceRef.current = null;
      if (okSinceRef.current === null) okSinceRef.current = now;
      if (audioTooLow && now - okSinceRef.current >= LOW_EXIT_MS) {
        setAudioTooLow(false);
      }
    }
    // In the dead zone between LOW_ENTER_DB and LOW_EXIT_DB, hold current state.
  }, [peak, hasStream, audioTooLow]);

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
