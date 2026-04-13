'use client';

import { useState, useEffect } from 'react';
import { useAudioLevel } from '@/hooks/useAudioLevel';
import { useAudioHealth } from '@/hooks/useAudioHealth';
import { AudioHealthMeter } from '@/components/broadcast/AudioHealthMeter';
import { AudioInputMethod } from '@/types/broadcast';

interface AudioStatusPanelProps {
  inputMethod: AudioInputMethod | null;
  stream: MediaStream | null;
  isLive: boolean;
  isPublishing: boolean;
  canGoLive: boolean;
  goLiveMessage?: string;
  onGoLive: () => void;
  isGoingLive: boolean;
  onChangeAudioSetup?: () => void;
  onChangeSource?: () => void;
  audioSourceLabel?: string | null;
  isRecordingMode?: boolean; // Show "START RECORDING" instead of "GO LIVE"
  roomOccupied?: boolean;    // Previous DJ still broadcasting
  roomFreeAt?: number | null; // When the previous DJ's slot ends (Unix ms)
  onQueueGoLive?: () => void; // Queue to auto go-live when room clears
  slotStartTime?: number;    // Slot start time (Unix ms) for "available in X minutes" countdown
}

export function AudioStatusPanel({
  inputMethod,
  stream,
  isLive,
  isPublishing,
  canGoLive,
  goLiveMessage,
  onGoLive,
  isGoingLive,
  onChangeAudioSetup,
  onChangeSource,
  audioSourceLabel,
  isRecordingMode = false,
  roomOccupied = false,
  // roomFreeAt — currently unused, kept in props interface for future use
  onQueueGoLive,
  slotStartTime,
}: AudioStatusPanelProps) {
  const level = useAudioLevel(stream);
  const health = useAudioHealth(stream);
  // Tie checklist to real broadcast-level signal, not just "any signal detected".
  // At least one channel must reach "active" (peak > -20 dB) for the check to pass.
  const hasStrongAudio = health.leftState === 'active' || health.rightState === 'active';
  // Kept for legacy "levels detected at all" decisions
  const hasAudioLevels = level > 0.01;

  // Countdown for "Going live available in X minutes" when too early
  const [minutesUntilAvailable, setMinutesUntilAvailable] = useState<number | null>(null);
  useEffect(() => {
    if (!slotStartTime || canGoLive) {
      setMinutesUntilAvailable(null);
      return;
    }
    const update = () => {
      const oneMinuteBefore = slotStartTime - 60 * 1000;
      const remaining = Math.max(Math.ceil((oneMinuteBefore - Date.now()) / 60000), 1);
      setMinutesUntilAvailable(remaining);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [slotStartTime, canGoLive]);

  // Seconds countdown: when canGoLive but room empty and before actual start time
  const [secondsUntilStart, setSecondsUntilStart] = useState<number | null>(null);
  useEffect(() => {
    if (!slotStartTime || !canGoLive || roomOccupied) {
      setSecondsUntilStart(null);
      return;
    }
    const update = () => {
      const remaining = Math.max(0, Math.ceil((slotStartTime - Date.now()) / 1000));
      setSecondsUntilStart(remaining > 0 ? remaining : null);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [slotStartTime, canGoLive, roomOccupied]);

  // Get display name for input method
  const getInputMethodLabel = () => {
    switch (inputMethod) {
      case 'system':
        return 'System Audio';
      case 'device':
        return 'Audio Device';
      case 'rtmp':
        return 'RTMP Ingress';
      default:
        return 'No input';
    }
  };

  // Build checklist items based on input method
  const getStatusItems = () => {
    const items: { id: string; label: string; checked: boolean }[] = [];

    // Add method-specific checklist items
    if (inputMethod === 'device' && !isLive) {
      items.push({
        id: 'macos-io',
        label: 'macOS input & output set to mixer/controller (levels moving in Sound Settings)',
        checked: hasStrongAudio,
      });
      items.push({
        id: 'chrome-input',
        label: 'channel-app.com allowed to capture your audio (chrome://settings/content/siteDetails?site=https%3A%2F%2Fchannel-app.com)',
        checked: !!stream,
      });
      items.push({
        id: 'chrome-audio-input',
        label: 'Chrome audio input set to your mixer/controller or audio interface',
        checked: !!stream,
      });
    }

    if (inputMethod === 'system' && !isLive) {
      items.push({
        id: 'browser-audio',
        label: 'Chrome has Screen & System Audio Recording permission for audio only (one-time setup)',
        checked: !!stream,
      });
    }

    // Common item for both paths
    if (!isLive) {
      items.push({
        id: 'levels',
        label: 'Audio levels strong on the Channel Go Live page — and NOT coming from your microphone',
        checked: hasStrongAudio,
      });
    }

    if (isLive) {
      items.push({
        id: 'connected',
        label: `${getInputMethodLabel()} connected`,
        checked: !!stream || inputMethod === 'rtmp',
      });
      items.push({
        id: 'publishing',
        label: 'Stream publishing',
        checked: isPublishing,
      });
    }

    return items;
  };

  const statusItems = getStatusItems();

  return (
    <div className="bg-[#252525] rounded-xl p-4">
      <h3 className="text-gray-400 text-sm font-medium mb-3">Audio System</h3>

      {/* Input method and source with aligned change buttons */}
      <div className="mb-4 space-y-2">
        {/* Input method row */}
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 bg-gray-800 text-white text-sm px-3 py-1.5 rounded-lg">
            {inputMethod === 'system' && (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            )}
            {inputMethod === 'device' && (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}
            {inputMethod === 'rtmp' && (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z" />
              </svg>
            )}
            {getInputMethodLabel()}
          </span>
          {onChangeAudioSetup && !isLive && (
            <button
              onClick={onChangeAudioSetup}
              className="text-accent hover:text-accent-hover text-sm transition-colors"
            >
              Change
            </button>
          )}
        </div>
        {/* Source row */}
        {audioSourceLabel && (
          <div className="flex items-center justify-between">
            <p className="text-gray-400 text-sm truncate pr-4" title={audioSourceLabel}>
              {audioSourceLabel}
            </p>
            {onChangeSource && !isLive && (
              <button
                onClick={onChangeSource}
                className="text-accent hover:text-accent-hover text-sm transition-colors flex-shrink-0"
              >
                Change
              </button>
            )}
          </div>
        )}
      </div>

      {/* Per-channel audio health meter — works before and after going live.
          Catches dead channels, silent audio, and periodic dropouts. */}
      {stream && (
        <div className="mb-4">
          <AudioHealthMeter stream={stream} isLive={isLive} />
        </div>
      )}

      {/* Status checklist - only show when not live */}
      {!isLive && (
        <div className="space-y-2 mb-4">
          {statusItems.map((item) => (
            <div key={item.id} className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                item.checked ? 'bg-green-500' : 'bg-gray-700'
              }`}>
                {item.checked ? (
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <div className="w-2 h-2 bg-gray-500 rounded-full" />
                )}
              </div>
              <span className={`text-sm ${item.checked ? 'text-white' : 'text-gray-500'}`}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Setup tip - show method-specific guidance when not live */}
      {!isLive && inputMethod === 'device' && (
        <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-3 mb-4">
          <p className="text-blue-200 text-sm font-medium mb-1">
            Set your audio input in Chrome
          </p>
          <p className="text-blue-200/80 text-xs">
            In the address bar, click the audio/microphone icon → Set Audio input to your mixer, controller, or audio interface
          </p>
        </div>
      )}

      {/* Microphone warning - always show before going live */}
      {!isLive && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 mb-4">
          <p className="text-yellow-200 text-sm">
            {inputMethod === 'device'
              ? 'Verify audio input is your mixer/controller, not built-in microphone'
              : 'Verify sound is not coming from your microphone'}
          </p>
        </div>
      )}

      {/* Action: GO LIVE / START RECORDING button (pre-live) or Troubleshoot link (live) */}
      <style>{`
        @keyframes pump-red {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.6); }
          50% { transform: scale(1.05); box-shadow: 0 0 20px 4px rgba(220, 38, 38, 0.4); }
        }
        @keyframes pump-amber {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.6); }
          50% { transform: scale(1.05); box-shadow: 0 0 20px 4px rgba(217, 119, 6, 0.4); }
        }
      `}</style>
      {!isLive ? (
        <div className="overflow-hidden">
          {canGoLive ? (
            <>
              {roomOccupied && onQueueGoLive ? (
                <>
                  <button
                    onClick={onQueueGoLive}
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-4 px-6 rounded-lg text-xl transition-colors"
                    style={{ animation: 'pump-amber 1.5s ease-in-out infinite' }}
                  >
                    Queue Auto Go-Live
                  </button>
                  <p className="text-amber-400/80 text-sm text-center mt-2">
                    Your live slot starts in less than a minute
                  </p>
                </>
              ) : secondsUntilStart !== null ? (
                <div>
                  <button
                    disabled
                    className="w-full bg-orange-600/30 border-2 border-orange-500 cursor-not-allowed text-orange-300 font-bold py-4 px-6 rounded-lg text-xl"
                  >
                    GO LIVE in {secondsUntilStart}s
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={onGoLive}
                    disabled={isGoingLive}
                    className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg text-xl transition-colors"
                    style={!isGoingLive ? { animation: 'pump-red 1.5s ease-in-out infinite' } : undefined}
                  >
                    {isGoingLive
                      ? (isRecordingMode ? 'Starting recording...' : 'Going live...')
                      : (isRecordingMode ? 'START RECORDING' : 'GO LIVE')}
                  </button>
                  {!isGoingLive && (
                    <p className="text-red-400/80 text-sm text-center mt-2">
                      Your live slot has started already
                    </p>
                  )}
                </>
              )}
            </>
          ) : (
            <div>
              <button
                disabled
                className="w-full bg-orange-600/30 border-2 border-orange-500 cursor-not-allowed text-orange-300 font-bold py-4 px-6 rounded-lg text-xl"
              >
                {minutesUntilAvailable !== null
                  ? `Going live available in ${minutesUntilAvailable} minute${minutesUntilAvailable > 1 ? 's' : ''}`
                  : goLiveMessage || 'Not available yet'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <a
          href="/streaming-guide"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 hover:text-gray-400 text-sm transition-colors"
        >
          Troubleshoot audio →
        </a>
      )}
    </div>
  );
}
