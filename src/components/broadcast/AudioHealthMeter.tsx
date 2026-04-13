'use client';

import { useAudioHealth } from '@/hooks/useAudioHealth';

interface AudioHealthMeterProps {
  stream: MediaStream | null;
  isLive: boolean;
}

// Map dB to 0-1 for bar height (bar range: -60dB silent → 0dB peak)
function dbToBarHeight(db: number): number {
  if (db <= -60) return 0;
  if (db >= 0) return 1;
  return (db + 60) / 60;
}

function stateColor(state: 'active' | 'silent' | 'weak'): string {
  switch (state) {
    case 'active': return 'bg-green-500';
    case 'weak': return 'bg-yellow-500';
    case 'silent': return 'bg-red-500';
  }
}

function ChannelBar({
  label,
  levelDb,
  state,
}: {
  label: 'L' | 'R';
  levelDb: number;
  state: 'active' | 'silent' | 'weak';
}) {
  const height = dbToBarHeight(levelDb);
  const pct = Math.round(height * 100);
  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <div className="text-[10px] text-gray-400 font-mono">{label}</div>
      <div className="w-full h-24 bg-gray-900 rounded relative overflow-hidden border border-gray-700">
        {/* dB markers */}
        <div className="absolute inset-x-0 top-[33%] border-t border-gray-700/50" title="-20dB" />
        <div className="absolute inset-x-0 top-[17%] border-t border-red-500/30" title="-10dB" />
        {/* Fill */}
        <div
          className={`absolute bottom-0 left-0 right-0 ${stateColor(state)} transition-all duration-75`}
          style={{ height: `${pct}%` }}
        />
      </div>
      <div className="text-[10px] text-gray-500 font-mono tabular-nums">
        {levelDb > -99 ? levelDb.toFixed(0) : '−∞'} dB
      </div>
    </div>
  );
}

export function AudioHealthMeter({ stream, isLive }: AudioHealthMeterProps) {
  const health = useAudioHealth(stream);

  if (!stream) return null;

  const hasMono = health.mono;
  const leftDead = health.leftState === 'silent' && health.rightState === 'active';
  const rightDead = health.rightState === 'silent' && health.leftState === 'active';
  const bothSilent = health.leftState === 'silent' && health.rightState === 'silent';

  // Dropout severity
  const dropoutLevel =
    health.recentDropouts === 0 ? 'clean' :
    health.recentDropouts <= 3 ? 'warn' :
    'alert';

  const dropoutColor =
    dropoutLevel === 'clean' ? 'text-green-400' :
    dropoutLevel === 'warn' ? 'text-yellow-400' :
    'text-red-400';

  return (
    <div className="bg-[#1a1a1a] rounded-lg p-3 border border-gray-800">
      <div className="flex items-center justify-between mb-2">
        <div className="text-gray-400 text-xs font-medium">
          Audio monitor {isLive ? '' : '(soundcheck)'}
        </div>
        <div className={`text-xs font-mono ${dropoutColor}`}>
          {health.recentDropouts === 0
            ? 'no dropouts'
            : `${health.recentDropouts} dropout${health.recentDropouts === 1 ? '' : 's'} / min`}
        </div>
      </div>

      <div className="flex gap-3 items-end">
        <ChannelBar label="L" levelDb={health.leftPeakDb} state={health.leftState} />
        <ChannelBar label="R" levelDb={health.rightPeakDb} state={health.rightState} />
      </div>

      {/* Channel issue warnings */}
      {(leftDead || rightDead) && (
        <div className="mt-2 bg-red-900/30 border border-red-700/50 rounded px-2 py-1.5 text-xs text-red-200">
          ⚠️ {leftDead ? 'Left' : 'Right'} channel silent — check cables / mixer routing
        </div>
      )}
      {bothSilent && !hasMono && (
        <div className="mt-2 bg-yellow-900/30 border border-yellow-700/50 rounded px-2 py-1.5 text-xs text-yellow-200">
          No audio detected — make sure your source is playing
        </div>
      )}
      {dropoutLevel === 'alert' && (
        <div className="mt-2 bg-red-900/30 border border-red-700/50 rounded px-2 py-1.5 text-xs text-red-200">
          ⚠️ Frequent audio dropouts — check USB cable, interface connection, or CPU load
        </div>
      )}
      {dropoutLevel === 'warn' && (
        <div className="mt-2 bg-yellow-900/40 border border-yellow-700/40 rounded px-2 py-1.5 text-xs text-yellow-200">
          A few dropouts detected — keep an eye on the counter
        </div>
      )}

      {/* Total counter when live */}
      {isLive && health.totalDropouts > 0 && (
        <div className="mt-2 text-[10px] text-gray-500 font-mono">
          total dropouts this session: {health.totalDropouts}
        </div>
      )}
    </div>
  );
}
