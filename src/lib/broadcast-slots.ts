import { db } from './firebase';
import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { BroadcastSlotSerialized, BroadcastType, DJSlot, STATION_ID } from '@/types/broadcast';

const COLLECTION = 'broadcast-slots';

function generateToken(): string {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  let binary = '';
  for (let i = 0; i < array.length; i++) {
    binary += String.fromCharCode(array[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Helper to serialize a slot from Firestore data
function serializeSlot(docId: string, data: Record<string, unknown>): BroadcastSlotSerialized {
  return {
    id: docId,
    stationId: data.stationId as string,
    showName: data.showName as string,
    djName: data.djName as string | undefined,
    djEmail: data.djEmail as string | undefined,
    djSlots: data.djSlots as DJSlot[] | undefined,
    startTime: (data.startTime as { toMillis: () => number })?.toMillis() || 0,
    endTime: (data.endTime as { toMillis: () => number })?.toMillis() || 0,
    broadcastToken: data.broadcastToken as string,
    tokenExpiresAt: (data.tokenExpiresAt as { toMillis: () => number })?.toMillis() || 0,
    createdAt: (data.createdAt as { toMillis: () => number })?.toMillis() || 0,
    createdBy: data.createdBy as string,
    status: data.status as BroadcastSlotSerialized['status'],
    broadcastType: (data.broadcastType as BroadcastType) || 'remote',
    // Live DJ fields
    liveDjUserId: data.liveDjUserId as string | undefined,
    liveDjUsername: data.liveDjUsername as string | undefined,
    liveDjBio: data.liveDjBio as string | undefined,
    liveDjPhotoUrl: data.liveDjPhotoUrl as string | undefined,
    liveDjPromoText: data.liveDjPromoText as string | undefined,
    liveDjPromoHyperlink: data.liveDjPromoHyperlink as string | undefined,
    currentDjSlotId: data.currentDjSlotId as string | undefined,
    // Recording fields
    egressId: data.egressId as string | undefined,
    recordingEgressId: data.recordingEgressId as string | undefined,
    recordingUrl: data.recordingUrl as string | undefined,
    recordingStatus: data.recordingStatus as BroadcastSlotSerialized['recordingStatus'],
    recordingDuration: data.recordingDuration as number | undefined,
  };
}

export async function getSlots(stationId: string = STATION_ID): Promise<BroadcastSlotSerialized[]> {
  if (!db) throw new Error('Firestore not initialized');

  const q = query(
    collection(db, COLLECTION),
    where('stationId', '==', stationId),
    orderBy('startTime', 'desc')
  );

  const snapshot = await getDocs(q);
  const slots: BroadcastSlotSerialized[] = [];

  snapshot.forEach((doc) => {
    slots.push(serializeSlot(doc.id, doc.data()));
  });

  return slots;
}

export async function createSlot(data: {
  showName: string;
  djName?: string;
  djEmail?: string;
  djSlots?: DJSlot[];
  startTime: number;
  endTime: number;
  createdBy: string;
  broadcastType?: BroadcastType;
}): Promise<{ slot: BroadcastSlotSerialized; broadcastUrl: string }> {
  if (!db) throw new Error('Firestore not initialized');

  // Look up DJ info by email if provided
  let djUserId: string | null = null;
  let finalDjName = data.djName;
  let liveDjBio: string | null = null;
  let liveDjPhotoUrl: string | null = null;

  if (data.djEmail) {
    try {
      const res = await fetch(`/api/users/lookup-by-email?email=${encodeURIComponent(data.djEmail)}`);
      const djInfo = await res.json();
      if (djInfo) {
        djUserId = djInfo.djUserId;
        finalDjName = djInfo.djName || data.djName;
        liveDjBio = djInfo.liveDjBio;
        liveDjPhotoUrl = djInfo.liveDjPhotoUrl;
      }
    } catch (error) {
      console.error('Failed to lookup DJ info:', error);
    }
  }

  const broadcastType = data.broadcastType || 'remote';
  const startTimestamp = Timestamp.fromMillis(data.startTime);
  const endTimestamp = Timestamp.fromMillis(data.endTime);
  const tokenExpiresAt = Timestamp.fromMillis(data.endTime + 60 * 60 * 1000);
  const broadcastToken = generateToken();

  const slotData: Record<string, unknown> = {
    stationId: STATION_ID,
    showName: data.showName,
    djName: finalDjName || null,
    djEmail: data.djEmail || null,
    djUserId: djUserId || null,
    djSlots: data.djSlots || null,
    startTime: startTimestamp,
    endTime: endTimestamp,
    broadcastToken,
    tokenExpiresAt,
    createdAt: Timestamp.now(),
    createdBy: data.createdBy,
    status: 'scheduled',
    broadcastType,
    liveDjBio: liveDjBio || null,
    liveDjPhotoUrl: liveDjPhotoUrl || null,
  };

  const docRef = await addDoc(collection(db, COLLECTION), slotData);

  const slot: BroadcastSlotSerialized = {
    id: docRef.id,
    stationId: STATION_ID,
    showName: data.showName,
    djName: finalDjName,
    djEmail: data.djEmail,
    djUserId: djUserId || undefined,
    djSlots: data.djSlots,
    startTime: data.startTime,
    endTime: data.endTime,
    broadcastToken,
    tokenExpiresAt: tokenExpiresAt.toMillis(),
    createdAt: Date.now(),
    createdBy: data.createdBy,
    status: 'scheduled',
    broadcastType,
    liveDjBio: liveDjBio || undefined,
    liveDjPhotoUrl: liveDjPhotoUrl || undefined,
  };

  // All slots use token URLs
  const broadcastUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://channel-app.com'}/broadcast/live?token=${broadcastToken}`;

  return { slot, broadcastUrl };
}

export async function updateSlot(
  slotId: string,
  updates: Partial<{
    status: string;
    showName: string;
    djName: string;
    djEmail: string;
    djSlots: DJSlot[];
    startTime: number;
    endTime: number;
  }>
): Promise<void> {
  if (!db) throw new Error('Firestore not initialized');

  const updateData: Record<string, unknown> = {};

  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.showName !== undefined) updateData.showName = updates.showName;
  if (updates.djName !== undefined) updateData.djName = updates.djName || null;
  if (updates.djEmail !== undefined) updateData.djEmail = updates.djEmail || null;
  if (updates.djSlots !== undefined) updateData.djSlots = updates.djSlots || null;

  // Handle time updates - convert to Firestore Timestamps
  if (updates.startTime !== undefined) {
    updateData.startTime = Timestamp.fromMillis(updates.startTime);
  }
  if (updates.endTime !== undefined) {
    updateData.endTime = Timestamp.fromMillis(updates.endTime);
    // Also update token expiry (end time + 1 hour)
    updateData.tokenExpiresAt = Timestamp.fromMillis(updates.endTime + 60 * 60 * 1000);
  }

  await updateDoc(doc(db, COLLECTION, slotId), updateData);
}

export async function deleteSlot(slotId: string): Promise<void> {
  if (!db) throw new Error('Firestore not initialized');
  await deleteDoc(doc(db, COLLECTION, slotId));
}

export async function validateToken(token: string): Promise<{
  valid: boolean;
  slot?: BroadcastSlotSerialized;
  scheduleStatus?: 'early' | 'on-time' | 'late';
  message?: string;
  error?: string;
}> {
  if (!db) throw new Error('Firestore not initialized');

  // Look up the slot by token
  const q = query(
    collection(db, COLLECTION),
    where('broadcastToken', '==', token)
  );

  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    return { valid: false, error: 'Invalid token' };
  }

  const docSnap = snapshot.docs[0];
  const slot = serializeSlot(docSnap.id, docSnap.data());

  // Check if token has expired
  const now = Date.now();
  if (slot.tokenExpiresAt < now) {
    return { valid: false, error: 'Token has expired' };
  }

  // Check if slot is still valid (but allow if we're still within scheduled time - status may be stale)
  if ((slot.status === 'completed' || slot.status === 'missed') && now > slot.endTime) {
    return { valid: false, error: 'This broadcast slot has ended' };
  }

  // Determine schedule status
  let scheduleStatus: 'early' | 'on-time' | 'late' = 'on-time';
  let message = 'You are on schedule';

  const fifteenMinutes = 15 * 60 * 1000;

  if (now < slot.startTime - fifteenMinutes) {
    // More than 15 minutes before start
    scheduleStatus = 'early';
    const startDate = new Date(slot.startTime);
    const today = new Date();
    const isToday = startDate.getDate() === today.getDate() &&
      startDate.getMonth() === today.getMonth() &&
      startDate.getFullYear() === today.getFullYear();
    const timeStr = startDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (isToday) {
      message = `Your show starts at ${timeStr}`;
    } else {
      const dateStr = startDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      message = `Your show starts ${dateStr} at ${timeStr}`;
    }
  } else if (now > slot.startTime && now < slot.endTime) {
    // Show has already started but not ended - they're late joining
    scheduleStatus = 'late';
    message = `Your show started at ${new Date(slot.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  // Otherwise on-time: within 15 min before start, or after end (token will expire anyway)

  return { valid: true, slot, scheduleStatus, message };
}

