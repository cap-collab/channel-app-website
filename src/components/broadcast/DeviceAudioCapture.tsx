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
  const [isLoading, setIsLoading] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);

  // Load available audio devices
  useEffect(() => {
    const loadDevices = async () => {
      try {
        // Request permission first to get device labels
        await navigator.mediaDevices.getUserMedia({ audio: true });

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = allDevices
          .filter(d => d.kind === 'audioinput')
          .map(d => ({
            deviceId: d.deviceId,
            label: d.label || `Audio Input ${d.deviceId.slice(0, 8)}`,
          }));

        setDevices(audioInputs);
        if (audioInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(audioInputs[0].deviceId);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'NotAllowedError') {
          onError('Microphone permission denied. Please allow microphone access.');
        } else {
          onError('Failed to load audio devices');
        }
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
  }, [onError, selectedDeviceId]);

  const captureDeviceAudio = async () => {
    if (!selectedDeviceId) {
      onError('Please select an audio device');
      return;
    }

    setIsCapturing(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: selectedDeviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000,
          channelCount: 2,
        },
        video: false,
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
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
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
