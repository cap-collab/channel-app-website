'use client';

import { useState, useEffect } from 'react';
import { IngressInfo } from '@/types/broadcast';

interface RtmpIngressPanelProps {
  participantIdentity: string;
  onReady: () => void;
  onError: (error: string) => void;
  onBack: () => void;
}

export function RtmpIngressPanel({ participantIdentity, onReady, onError, onBack }: RtmpIngressPanelProps) {
  const [ingress, setIngress] = useState<IngressInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState<'url' | 'key' | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  // Create or get ingress on mount
  useEffect(() => {
    const createIngress = async () => {
      try {
        const res = await fetch('/api/livekit/ingress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            participantIdentity,
            participantName: participantIdentity,
          }),
        });

        const data = await res.json();

        if (data.error) {
          onError(data.error);
          return;
        }

        setIngress(data);
        setIsPolling(true);
      } catch {
        onError('Failed to create RTMP ingress');
      } finally {
        setIsLoading(false);
      }
    };

    createIngress();
  }, [participantIdentity, onError]);

  // Poll for ingress status
  useEffect(() => {
    if (!isPolling || !ingress) return;

    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/livekit/ingress?ingressId=${ingress.ingressId}`);
        const data = await res.json();

        if (data.status === 'publishing') {
          setIngress(prev => prev ? { ...prev, status: 'publishing' } : null);
          setIsPolling(false);
          onReady();
        } else if (data.status === 'buffering') {
          setIngress(prev => prev ? { ...prev, status: 'buffering' } : null);
        }
      } catch {
        console.error('Failed to poll ingress status');
      }
    };

    const interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, [isPolling, ingress, onReady]);

  const copyToClipboard = async (text: string, type: 'url' | 'key') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      console.error('Failed to copy');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    );
  }

  if (!ingress) {
    return (
      <div className="bg-red-900/30 border border-red-800 rounded-lg p-4">
        <p className="text-red-400">Failed to create RTMP ingress</p>
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

      <div className="bg-gray-900 rounded-xl p-6">
        <h2 className="text-xl font-semibold text-white mb-4">RTMP Stream Settings</h2>

        <div className="space-y-4">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <p className="text-gray-300 text-sm">
              Copy these settings into OBS Studio or your hardware encoder.
              Go to Settings → Stream and select &quot;Custom&quot; as the service.
            </p>
          </div>

          {/* RTMP URL */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">Server URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={ingress.url}
                className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm"
              />
              <button
                onClick={() => copyToClipboard(ingress.url, 'url')}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-3 rounded-lg transition-colors"
              >
                {copied === 'url' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Stream Key */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">Stream Key</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={ingress.streamKey}
                className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm"
              />
              <button
                onClick={() => copyToClipboard(ingress.streamKey, 'key')}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-3 rounded-lg transition-colors"
              >
                {copied === 'key' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Status indicator */}
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-3">
              {ingress.status === 'inactive' && (
                <>
                  <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse"></div>
                  <span className="text-yellow-400">Waiting for stream...</span>
                </>
              )}
              {ingress.status === 'buffering' && (
                <>
                  <div className="w-3 h-3 bg-gray-400 rounded-full animate-pulse"></div>
                  <span className="text-gray-400">Connecting...</span>
                </>
              )}
              {ingress.status === 'publishing' && (
                <>
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className="text-green-400">Receiving stream</span>
                </>
              )}
            </div>
            <p className="text-gray-500 text-sm mt-2">
              Start streaming from OBS and it will appear here automatically.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
