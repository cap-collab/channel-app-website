'use client';

import { useState, useEffect } from 'react';
import { AudioDevice } from '@/types/broadcast';

interface DeviceAudioCaptureProps {
  onStream: (stream: MediaStream) => void;
  onError: (error: string) => void;
  onBack: () => void;
}

export function DeviceAudioCapture({ onStream, onError, onBack }: DeviceAudioCaptureProps) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  // Track the selected device's human-readable label too. Browsers can reassign
  // a device's `deviceId` when it briefly drops and re-enumerates (a USB
  // interface hiccup, a sample-rate change). When that happens the stored
  // deviceId stops resolving and naive code silently falls back to the first
  // device — i.e. the laptop mic instead of the DJ's interface (seen with the
  // bilaliwood show 2026-06). Keeping the label lets us re-find the SAME
  // physical device under its new id.
  const [selectedLabel, setSelectedLabel] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);

  // Remember the selection by both id and label, so re-capture can pin the same
  // physical device even if its deviceId changed.
  const selectDevice = (id: string, label: string) => {
    setSelectedDeviceId(id);
    setSelectedLabel(label);
  };

  // Load available audio devices
  useEffect(() => {
    const loadDevices = async () => {
      try {
        // Request permission first to get device labels
        // This may fail on multi-channel devices (e.g. TASCAM Model 16) — that's OK,
        // enumerateDevices will still return labeled devices if permission was granted before
        try {
          await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false
            }
          });
        } catch (permError) {
          if (permError instanceof Error && permError.name === 'NotAllowedError') {
            onError('Microphone permission denied. Please allow microphone access.');
            return;
          }
          // For other errors (e.g. multi-channel device), retry with mono to satisfy Safari
          try {
            await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
          } catch {
            console.warn('getUserMedia retry also failed:', permError);
          }
        }

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = allDevices
          .filter(d => d.kind === 'audioinput')
          .map(d => ({
            deviceId: d.deviceId,
            label: d.label || `Unknown Audio Device ${d.deviceId.slice(0, 8)}`,
          }));

        // Debug logging to see what devices are detected
        console.log('Detected audio inputs:', audioInputs);
        console.log('All devices:', allDevices);

        setDevices(audioInputs);
        if (audioInputs.length > 0) {
          if (!selectedDeviceId) {
            // First load — default to the first device.
            selectDevice(audioInputs[0].deviceId, audioInputs[0].label);
          } else if (!audioInputs.some(d => d.deviceId === selectedDeviceId)) {
            // The selected deviceId no longer exists (device dropped + re-enumerated,
            // likely with a new id). Re-pin the SAME physical device by label rather
            // than silently sliding to audioInputs[0] (the laptop mic).
            const sameByLabel = selectedLabel
              ? audioInputs.find(d => d.label === selectedLabel)
              : undefined;
            if (sameByLabel) {
              console.log('🎙 Re-pinned audio device by label after id change:', sameByLabel.label);
              selectDevice(sameByLabel.deviceId, sameByLabel.label);
            }
            // If we can't find it, leave the selection as-is. The picker will show
            // the stale value and capture will surface an explicit error — we do
            // NOT auto-switch to a different device behind the DJ's back.
          }
        }
      } catch {
        onError('Failed to load audio devices');
      } finally {
        setIsLoading(false);
      }
    };

    loadDevices();

    // Listen for device changes
    const handleDeviceChange = () => loadDevices();
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [onError, selectedDeviceId, selectedLabel]);

  const captureDeviceAudio = async () => {
    if (!selectedDeviceId) {
      onError('Please select an audio device');
      return;
    }

    setIsCapturing(true);

    const audioConstraints = (deviceId: string): MediaTrackConstraints => ({
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: { ideal: 48000 },
      channelCount: { min: 1, ideal: 2 },
    });

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints(selectedDeviceId),
          video: false,
        });
      } catch (err) {
        // The exact deviceId no longer resolves (device re-enumerated with a new
        // id mid-session). Re-find the SAME device by label and retry once,
        // rather than letting the caller fall back to a default device.
        if (err instanceof Error && err.name === 'OverconstrainedError' && selectedLabel) {
          const fresh = await navigator.mediaDevices.enumerateDevices();
          const sameByLabel = fresh.find(d => d.kind === 'audioinput' && d.label === selectedLabel);
          if (!sameByLabel) throw err; // can't find it — surface the original error
          console.log('🎙 Exact deviceId stale; recapturing same device by label:', selectedLabel);
          selectDevice(sameByLabel.deviceId, sameByLabel.label);
          stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints(sameByLabel.deviceId),
            video: false,
          });
        } else {
          throw err;
        }
      }

      // Log what we actually got back — when a DJ reports "no audio," this
      // single line tells us whether the requested device was honored, the
      // channel count, sample rate, and whether the track is live. Silent-
      // success failures (a "successful" stream that produces no samples) are
      // hard to diagnose otherwise.
      const track = stream.getAudioTracks()[0];
      const settings = track?.getSettings?.() ?? {};
      console.log('🎙 Captured device audio:', {
        label: track?.label,
        deviceId: settings.deviceId?.slice(0, 12),
        channelCount: settings.channelCount,
        sampleRate: settings.sampleRate,
        readyState: track?.readyState,
        muted: track?.muted,
      });

      onStream(stream);
    } catch (error) {
      setIsCapturing(false);

      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          onError('Audio device permission denied.');
        } else if (error.name === 'NotFoundError') {
          onError('Selected audio device not found. It may have been disconnected.');
        } else {
          onError(error.message);
        }
      } else {
        onError('Failed to capture audio from device');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <div className="bg-[#252525] rounded-xl p-6">
        <h2 className="text-xl font-semibold text-white mb-4">Audio Interface</h2>

        <div className="space-y-4">
          {devices.length === 0 ? (
            <div className="bg-red-900/30 border border-red-800 rounded-lg p-4">
              <p className="text-red-400">
                No audio input devices found. Please connect an audio interface or microphone.
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Select Audio Input Device
                </label>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => {
                    const dev = devices.find(d => d.deviceId === e.target.value);
                    selectDevice(e.target.value, dev?.label ?? '');
                  }}
                  className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-gray-500"
                >
                  {devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <p className="text-gray-300 text-sm">
                  Make sure your DJ mixer, audio interface, or USB device is connected and selected above.
                  The audio will be captured in stereo at 48kHz.
                </p>
              </div>

              <button
                onClick={captureDeviceAudio}
                disabled={isCapturing || !selectedDeviceId}
                className="w-full bg-accent hover:bg-accent-hover disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition-colors"
              >
                {isCapturing ? 'Connecting...' : 'Connect Device'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
