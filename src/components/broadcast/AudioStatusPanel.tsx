'use client';

import { useAudioLevel } from '@/hooks/useAudioLevel';
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
}: AudioStatusPanelProps) {
  const level = useAudioLevel(stream);
  const hasAudioLevels = level > 0.01;

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
    const items = [
      {
        id: 'connected',
        label: `${getInputMethodLabel()} connected`,
        checked: !!stream || inputMethod === 'rtmp',
      },
    ];

    // Add method-specific items
    if (inputMethod === 'device' && !isLive) {
      // Check if audio source is NOT a built-in microphone
      const isExternalDevice = audioSourceLabel
        ? !audioSourceLabel.toLowerCase().includes('built-in')
          && !audioSourceLabel.toLowerCase().includes('macbook')
          && !audioSourceLabel.toLowerCase().includes('internal')
        : false;

      items.push({
        id: 'correct-input',
        label: 'Audio input set to mixer/controller (not built-in mic)',
        checked: isExternalDevice,
      });
    }

    if (inputMethod === 'system' && !isLive) {
      items.push({
        id: 'share-audio',
        label: 'Sharing tab or system audio (not just screen)',
        checked: !!stream && hasAudioLevels,
      });
    }

    items.push({
      id: 'levels',
      label: 'Audio levels detected',
      checked: hasAudioLevels,
    });

    if (isLive) {
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

      {/* Input method badge with change button */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
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
        {/* Show the specific source (e.g., "Spotify", "Chrome Tab Audio", device name) */}
        {audioSourceLabel && (
          <div className="flex items-center gap-2 mt-1.5">
            <p className="text-gray-400 text-xs truncate flex-1" title={audioSourceLabel}>
              {audioSourceLabel}
            </p>
            {onChangeSource && !isLive && (
              <button
                onClick={onChangeSource}
                className="text-accent hover:text-accent-hover text-xs transition-colors flex-shrink-0"
              >
                Change source
              </button>
            )}
          </div>
        )}
      </div>

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

      {/* Microphone warning - show when audio levels detected */}
      {hasAudioLevels && !isLive && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 mb-4">
          <p className="text-yellow-200 text-sm">
            {inputMethod === 'device'
              ? 'Verify audio input is your mixer/controller, not built-in microphone'
              : 'Verify sound is not coming from your microphone'}
          </p>
        </div>
      )}

      {/* Action: GO LIVE button (pre-live) or Troubleshoot link (live) */}
      {!isLive ? (
        <div>
          {canGoLive ? (
            <button
              onClick={onGoLive}
              disabled={isGoingLive}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg text-xl transition-colors"
            >
              {isGoingLive ? 'Going live...' : 'GO LIVE'}
            </button>
          ) : (
            <div className="text-center">
              <p className="text-gray-500 text-sm">{goLiveMessage}</p>
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
