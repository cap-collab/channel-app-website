import { EgressClient, RoomServiceClient } from 'livekit-server-sdk';
import { ROOM_NAME } from '@/types/broadcast';

const livekitHost = process.env.LIVEKIT_URL?.replace('wss://', 'https://') || '';
const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';

export interface SlotCleanupInput {
  slotId: string;
  egressId?: string;
  recordingEgressId?: string;
  restreamEgressId?: string;
  restreamWorkerId?: string;
  restreamIngressId?: string;
  liveDjUsername?: string;
  liveDjUserId?: string;
}

export interface SlotCleanupResult {
  stoppedHlsEgress: boolean;
  stoppedRecordingEgress: boolean;
  stoppedRestreamEgress: boolean;
  stoppedRestreamWorker: boolean;
  removedParticipant: boolean;
  participantIdentity: string | null;
  errors: string[];
}

// Cleanly releases a broadcast slot's LiveKit resources: stops HLS + recording +
// restream egresses, stops the restream worker if any, and removes the DJ (or
// restream bot) participant from the shared room. Each step is independent and
// failures don't block the others — this must remain idempotent since the cron
// will retry any slot that isn't fully cleaned up.
export async function cleanupSlotLiveKit(slot: SlotCleanupInput): Promise<SlotCleanupResult> {
  const result: SlotCleanupResult = {
    stoppedHlsEgress: false,
    stoppedRecordingEgress: false,
    stoppedRestreamEgress: false,
    stoppedRestreamWorker: false,
    removedParticipant: false,
    participantIdentity: null,
    errors: [],
  };

  if (!livekitHost || !apiKey || !apiSecret) {
    result.errors.push('LiveKit not configured');
    return result;
  }

  const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);
  const roomService = new RoomServiceClient(livekitHost, apiKey, apiSecret);

  // Restream worker (Hetzner) — stop before egress so it doesn't keep publishing
  if (slot.restreamWorkerId || slot.restreamIngressId) {
    const restreamWorkerUrl = process.env.RESTREAM_WORKER_URL;
    if (restreamWorkerUrl) {
      try {
        await fetch(`${restreamWorkerUrl}/stop`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.CRON_SECRET}`,
          },
          body: JSON.stringify({ slotId: slot.slotId }),
        });
        result.stoppedRestreamWorker = true;
      } catch (e) {
        result.errors.push(`restream-worker: ${e}`);
      }
    }
  }

  if (slot.recordingEgressId) {
    try {
      await egressClient.stopEgress(slot.recordingEgressId);
      result.stoppedRecordingEgress = true;
    } catch (e) {
      result.errors.push(`recording-egress: ${e}`);
    }
  }

  if (slot.egressId) {
    try {
      await egressClient.stopEgress(slot.egressId);
      result.stoppedHlsEgress = true;
    } catch (e) {
      result.errors.push(`hls-egress: ${e}`);
    }
  }

  if (slot.restreamEgressId) {
    try {
      await egressClient.stopEgress(slot.restreamEgressId);
      result.stoppedRestreamEgress = true;
    } catch (e) {
      result.errors.push(`restream-egress: ${e}`);
    }
  }

  const identity = (slot.restreamWorkerId || slot.restreamIngressId)
    ? `restream-${slot.slotId}`
    : (slot.liveDjUsername || slot.liveDjUserId);
  if (identity) {
    result.participantIdentity = identity;
    try {
      await roomService.removeParticipant(ROOM_NAME, identity);
      result.removedParticipant = true;
    } catch (e) {
      // Participant may have already disconnected — not an error per se
      result.errors.push(`remove-participant(${identity}): ${e}`);
    }
  }

  return result;
}
