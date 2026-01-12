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

      <div className="bg-[#252525] rounded-xl p-6">
        <h2 className="text-xl font-semibold text-white mb-4">System Audio Capture</h2>

        <div className="space-y-4">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <h3 className="text-gray-300 font-medium mb-3">Choose what to share:</h3>
            <div className="space-y-4">
              <div>
                <p className="text-gray-300 text-sm mb-1">If you play audio from a browser tab</p>
                <p className="text-gray-500 text-xs mb-2">(SoundCloud, Mixcloud, Bandcamp)</p>
                <ul className="text-gray-400 text-sm list-disc list-inside">
                  <li>Select the browser tab</li>
                  <li>Toggle <span className="text-white">&quot;Also share tab audio&quot;</span></li>
                </ul>
              </div>
              <div className="border-t border-gray-700 pt-4">
                <p className="text-gray-300 text-sm mb-1">If you play audio from an application</p>
                <p className="text-gray-500 text-xs mb-2">(iTunes, Apple Music, Spotify, Serato, Rekordbox)</p>
                <ul className="text-gray-400 text-sm list-disc list-inside">
                  <li>Select <span className="text-white">System Audio</span></li>
                  <li>Toggle <span className="text-white">&quot;Also share system audio&quot;</span></li>
                </ul>
              </div>
            </div>
          </div>

          <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-4">
            <h3 className="text-yellow-400 font-medium mb-2">macOS Users (one-time setup):</h3>
            <p className="text-gray-300 text-sm">
              You need Screen &amp; System Audio Recording permission in{' '}
              <span className="text-white">System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording</span>
              {' '}— enable for Google Chrome (audio only).
            </p>
          </div>

          {/* Checklist */}
          <div className="border-t border-gray-700 pt-4">
            <p className="text-gray-400 text-sm mb-3">Before going live, check:</p>
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded border border-gray-600 flex items-center justify-center mt-0.5">
                  <svg className="w-3 h-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-gray-300 text-sm">Chrome has Screen &amp; System Audio Recording permission for audio only (one-time setup)</span>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded border border-gray-600 flex items-center justify-center mt-0.5">
                  <svg className="w-3 h-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-gray-300 text-sm">Audio levels moving on the Channel Go Live page — and NOT coming from your microphone</span>
              </div>
            </div>
          </div>

          <button
            onClick={captureSystemAudio}
            disabled={isCapturing}
            className="w-full bg-accent hover:bg-accent-hover disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition-colors"
          >
            {isCapturing ? 'Requesting permission...' : 'Start Capture'}
          </button>
        </div>
      </div>
    </div>
  );
}
