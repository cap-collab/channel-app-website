'use client';

import { useState } from 'react';

interface SystemAudioCaptureProps {
  onStream: (stream: MediaStream) => void;
  onError: (error: string) => void;
  onBack: () => void;
}

export function SystemAudioCapture({ onStream, onError, onBack }: SystemAudioCaptureProps) {
  const [isCapturing, setIsCapturing] = useState(false);

  const captureSystemAudio = async () => {
    setIsCapturing(true);

    try {
      // Request screen share with audio
      // Note: video: true is required by browsers, but we discard the video track
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      // Stop video track immediately - we only want audio
      stream.getVideoTracks().forEach(track => track.stop());

      // Check if we got audio
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        onError('No audio captured. Make sure to check "Share audio" in the screen share dialog.');
        setIsCapturing(false);
        return;
      }

      onStream(stream);
    } catch (error) {
      setIsCapturing(false);

      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          onError('Screen share permission denied. Please allow screen sharing to continue.');
        } else {
          onError(error.message);
        }
      } else {
        onError('Failed to capture system audio');
      }
    }
  };

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

      <div className="bg-gray-900 rounded-xl p-6">
        <h2 className="text-xl font-semibold text-white mb-4">System Audio Capture</h2>

        <div className="space-y-4">
          <div className="bg-blue-900/30 border border-blue-800 rounded-lg p-4">
            <h3 className="text-blue-400 font-medium mb-2">How it works:</h3>
            <ol className="text-gray-300 text-sm space-y-2 list-decimal list-inside">
              <li>Click &quot;Start Capture&quot; below</li>
              <li>A screen share dialog will appear</li>
              <li>Select any window or screen (we only use the audio)</li>
              <li>
                <span className="text-yellow-400 font-medium">Important:</span> Check the
                &quot;Share audio&quot; or &quot;Share system audio&quot; checkbox
              </li>
            </ol>
          </div>

          <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-4">
            <h3 className="text-yellow-400 font-medium mb-2">macOS Users:</h3>
            <p className="text-gray-300 text-sm">
              You may need to grant Screen Recording permission in{' '}
              <span className="text-white">System Preferences → Privacy & Security → Screen Recording</span>
            </p>
          </div>

          <button
            onClick={captureSystemAudio}
            disabled={isCapturing}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition-colors"
          >
            {isCapturing ? 'Requesting permission...' : 'Start Capture'}
          </button>
        </div>
      </div>
    </div>
  );
}
