'use client';

import { useEffect, useRef } from 'react';
import { Room } from 'livekit-client';

// Telemetry-only hook: polls WebRTC publisher stats during a broadcast and
// buffers them in memory. Sends nothing during the broadcast — caller calls
// flush() at end to get the buffered payload.
//
// Designed to be non-priority and non-blocking:
//   - Behind NEXT_PUBLIC_PUBLISHER_STATS_ENABLED flag (default off)
//   - All work wrapped in try/catch — a bug here cannot affect publish
//   - Buffer is capped to MAX_SAMPLES (rolling)
//   - Polling interval is 5s — minimal CPU on the publish thread

const POLL_INTERVAL_MS = 5_000;
const MAX_SAMPLES = 1_000;          // ~1.4h at 5s intervals; rolling cap
const STALL_PACKETS_LOST_THRESHOLD = 5;     // packets lost in one interval
const STALL_BYTES_DROP_THRESHOLD = 0.2;     // <20% of expected bytes = capture stall

interface StatsSample {
  t: number;                  // ms since broadcast start
  packetsSent: number;
  packetsLost: number;
  bytesSent: number;
  jitter: number;             // seconds
  rtt: number | null;         // round-trip time, seconds
}

interface StallEvent {
  tSec: number;
  packetsLostDelta: number;
  bytesSentDelta: number;
  jitter: number;
  reason: 'packet-loss' | 'capture-stall';
}

export interface PublisherStatsPayload {
  collectedFrom: number;
  collectedTo: number;
  durationSec: number;
  totalSamples: number;
  stallEvents: StallEvent[];
  summary: {
    totalPacketsSent: number;
    totalPacketsLost: number;
    peakJitter: number;
    avgBitrate: number;
    stallCount: number;
  };
}

export function usePublisherStats(room: Room | null, isLive: boolean) {
  const samplesRef = useRef<StatsSample[]>([]);
  const stallsRef = useRef<StallEvent[]>([]);
  const startMsRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const enabled = process.env.NEXT_PUBLIC_PUBLISHER_STATS_ENABLED === 'true';
    if (!enabled || !isLive || !room) return;

    // Reset on each new broadcast
    samplesRef.current = [];
    stallsRef.current = [];
    startMsRef.current = Date.now();

    const tick = async () => {
      try {
        const lp = room.localParticipant;
        if (!lp) return;

        // Get the audio track publication's sender stats
        const pub = Array.from(lp.audioTrackPublications.values())[0];
        const sender = pub?.track?.sender;
        if (!sender) return;

        const report = await sender.getStats();
        let packetsSent = 0;
        let packetsLost = 0;
        let bytesSent = 0;
        let jitter = 0;
        let rtt: number | null = null;

        report.forEach((stat) => {
          if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
            packetsSent = stat.packetsSent || 0;
            bytesSent = stat.bytesSent || 0;
          }
          if (stat.type === 'remote-inbound-rtp' && stat.kind === 'audio') {
            packetsLost = stat.packetsLost || 0;
            jitter = stat.jitter || 0;
            rtt = typeof stat.roundTripTime === 'number' ? stat.roundTripTime : null;
          }
          if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && rtt === null) {
            rtt = typeof stat.currentRoundTripTime === 'number' ? stat.currentRoundTripTime : null;
          }
        });

        const startMs = startMsRef.current ?? Date.now();
        const t = Date.now() - startMs;
        const sample: StatsSample = { t, packetsSent, packetsLost, bytesSent, jitter, rtt };

        const prev = samplesRef.current[samplesRef.current.length - 1];
        samplesRef.current.push(sample);

        // Rolling cap
        if (samplesRef.current.length > MAX_SAMPLES) {
          samplesRef.current.shift();
        }

        // Stall detection (compare to previous sample)
        if (prev) {
          const packetsLostDelta = packetsLost - prev.packetsLost;
          const bytesSentDelta = bytesSent - prev.bytesSent;
          const expectedBytes = (prev.bytesSent && samplesRef.current.length > 2)
            ? Math.max(...samplesRef.current.slice(-10).map((s, i, arr) =>
                i > 0 ? s.bytesSent - arr[i - 1].bytesSent : 0
              ))
            : 0;

          if (packetsLostDelta >= STALL_PACKETS_LOST_THRESHOLD) {
            stallsRef.current.push({
              tSec: t / 1000,
              packetsLostDelta,
              bytesSentDelta,
              jitter,
              reason: 'packet-loss',
            });
          } else if (
            expectedBytes > 0 &&
            bytesSentDelta > 0 &&
            bytesSentDelta < expectedBytes * STALL_BYTES_DROP_THRESHOLD
          ) {
            stallsRef.current.push({
              tSec: t / 1000,
              packetsLostDelta,
              bytesSentDelta,
              jitter,
              reason: 'capture-stall',
            });
          }
        }
      } catch {
        // Telemetry bug must never affect broadcast — swallow silently.
      }
    };

    intervalRef.current = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [room, isLive]);

  // Caller invokes this from endBroadcast(), AFTER critical path runs.
  // Returns null if disabled or no data.
  const flush = (): PublisherStatsPayload | null => {
    try {
      const enabled = process.env.NEXT_PUBLIC_PUBLISHER_STATS_ENABLED === 'true';
      if (!enabled) return null;
      const samples = samplesRef.current;
      const stalls = stallsRef.current;
      const startMs = startMsRef.current;
      if (!startMs || samples.length === 0) return null;

      const last = samples[samples.length - 1];
      const totalPacketsSent = last.packetsSent;
      const totalPacketsLost = last.packetsLost;
      const peakJitter = samples.reduce((m, s) => Math.max(m, s.jitter), 0);
      const durationSec = last.t / 1000;
      const avgBitrate = durationSec > 0 ? (last.bytesSent * 8) / durationSec : 0;

      const payload: PublisherStatsPayload = {
        collectedFrom: startMs,
        collectedTo: startMs + last.t,
        durationSec,
        totalSamples: samples.length,
        stallEvents: stalls.slice(0, 200),  // hard cap to keep doc small
        summary: {
          totalPacketsSent,
          totalPacketsLost,
          peakJitter,
          avgBitrate: Math.round(avgBitrate),
          stallCount: stalls.length,
        },
      };

      // Reset for the next broadcast (in case the hook is reused)
      samplesRef.current = [];
      stallsRef.current = [];
      startMsRef.current = null;

      return payload;
    } catch {
      return null;
    }
  };

  return { flush };
}
