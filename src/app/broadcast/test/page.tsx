'use client';

import { useState, useRef } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';

export default function BroadcastTestPage() {
  const [status, setStatus] = useState<string>('Not connected');
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [egressId, setEgressId] = useState<string | null>(null);
  const [egressStatus, setEgressStatus] = useState<string>('');
  const roomRef = useRef<Room | null>(null);

  const connect = async () => {
    try {
      setStatus('Fetching token...');

      const res = await fetch('/api/livekit/token?room=test-room&username=dj-test');
      const data = await res.json();

      if (data.error) {
        setStatus(`Error: ${data.error}`);
        return;
      }

      setStatus('Connecting to LiveKit...');

      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.Connected, () => {
        setStatus('Connected to LiveKit!');
        setIsConnected(true);
      });

      room.on(RoomEvent.Disconnected, () => {
        setStatus('Disconnected');
        setIsConnected(false);
        setIsStreaming(false);
      });

      await room.connect(data.url, data.token);

    } catch (error) {
      setStatus(`Connection error: ${error}`);
    }
  };

  const startStreaming = async () => {
    if (!roomRef.current) return;

    try {
      setStatus('Requesting microphone access...');

      const audioTrack = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      const track = audioTrack.getAudioTracks()[0];

      setStatus('Publishing audio...');
      await roomRef.current.localParticipant.publishTrack(track, {
        name: 'microphone',
        source: Track.Source.Microphone,
      });

      setStatus('Streaming audio to LiveKit!');
      setIsStreaming(true);

    } catch (error) {
      setStatus(`Streaming error: ${error}`);
    }
  };

  const stopStreaming = async () => {
    if (!roomRef.current) return;

    try {
      const publication = roomRef.current.localParticipant.audioTrackPublications.values().next().value;
      if (publication?.track) {
        await roomRef.current.localParticipant.unpublishTrack(publication.track);
      }
      setStatus('Stopped streaming');
      setIsStreaming(false);
    } catch (error) {
      setStatus(`Error stopping: ${error}`);
    }
  };

  const disconnect = () => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    setIsConnected(false);
    setIsStreaming(false);
    setStatus('Disconnected');
  };

  const startEgress = async () => {
    try {
      setEgressStatus('Starting HLS egress...');
      const res = await fetch('/api/livekit/egress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: 'test-room' }),
      });
      const data = await res.json();

      if (data.error) {
        setEgressStatus(`Error: ${data.error}`);
        return;
      }

      setEgressId(data.egressId);
      setEgressStatus(`HLS egress active (ID: ${data.egressId.slice(0, 8)}...)`);
    } catch (error) {
      setEgressStatus(`Egress error: ${error}`);
    }
  };

  const stopEgress = async () => {
    if (!egressId) return;

    try {
      setEgressStatus('Stopping egress...');
      await fetch('/api/livekit/egress', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ egressId }),
      });

      setEgressId(null);
      setEgressStatus('Egress stopped');
    } catch (error) {
      setEgressStatus(`Stop error: ${error}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#1a1a1a] text-white p-8">
      <h1 className="text-3xl font-bold mb-8">Broadcast Test</h1>

      <div className="bg-[#252525] rounded-lg p-6 max-w-md">
        <div className="mb-6">
          <p className="text-gray-400 text-sm">Status</p>
          <p className="text-xl font-mono">{status}</p>
        </div>

        <div className="space-y-4">
          {!isConnected ? (
            <button
              onClick={connect}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg"
            >
              Connect to LiveKit
            </button>
          ) : (
            <>
              {!isStreaming ? (
                <button
                  onClick={startStreaming}
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg"
                >
                  Start Streaming (Microphone)
                </button>
              ) : (
                <button
                  onClick={stopStreaming}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg"
                >
                  Stop Streaming
                </button>
              )}

              <button
                onClick={disconnect}
                className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg"
              >
                Disconnect
              </button>
            </>
          )}
        </div>

        {isStreaming && (
          <div className="mt-6 flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
            <span className="text-red-400 font-bold">LIVE</span>
          </div>
        )}
      </div>

      {/* HLS Egress Controls */}
      {isStreaming && (
        <div className="bg-[#252525] rounded-lg p-6 max-w-md mt-6">
          <h2 className="text-xl font-bold mb-4">HLS Output</h2>

          {egressStatus && (
            <p className="text-gray-400 mb-4 font-mono text-sm">{egressStatus}</p>
          )}

          {!egressId ? (
            <button
              onClick={startEgress}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg"
            >
              Start HLS Egress
            </button>
          ) : (
            <button
              onClick={stopEgress}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-6 rounded-lg"
            >
              Stop HLS Egress
            </button>
          )}

          <p className="text-gray-500 text-xs mt-4">
            HLS egress converts the LiveKit stream to HLS format for playback in iOS apps.
          </p>
        </div>
      )}

      <div className="mt-8 text-gray-500 text-sm">
        <p>This page tests the LiveKit connection.</p>
        <p>1. Click &quot;Connect&quot; to join a LiveKit room</p>
        <p>2. Click &quot;Start Streaming&quot; to broadcast your microphone</p>
        <p>3. Click &quot;Start HLS Egress&quot; to create an HLS stream</p>
        <p>4. Check the LiveKit dashboard to see the active room and egress</p>
      </div>
    </div>
  );
}
