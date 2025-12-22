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
import { BroadcastSlotSerialized, BroadcastType, STATION_ID } from '@/types/broadcast';

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
    const data = doc.data();
    slots.push({
      id: doc.id,
      stationId: data.stationId,
      djName: data.djName,
      showName: data.showName,
      startTime: data.startTime?.toMillis() || 0,
      endTime: data.endTime?.toMillis() || 0,
      broadcastToken: data.broadcastToken,
      tokenExpiresAt: data.tokenExpiresAt?.toMillis() || 0,
      createdAt: data.createdAt?.toMillis() || 0,
      createdBy: data.createdBy,
      status: data.status,
      broadcastType: data.broadcastType || 'venue', // Default to venue for existing slots
    });
  });

  return slots;
}

export async function createSlot(data: {
  djName: string;
  showName?: string;
  startTime: number;
  endTime: number;
  createdBy: string;
  broadcastType?: BroadcastType;
}): Promise<{ slot: BroadcastSlotSerialized; broadcastUrl: string }> {
  if (!db) throw new Error('Firestore not initialized');

  const broadcastType = data.broadcastType || 'venue';
  const startTimestamp = Timestamp.fromMillis(data.startTime);
  const endTimestamp = Timestamp.fromMillis(data.endTime);
  const tokenExpiresAt = Timestamp.fromMillis(data.endTime + 60 * 60 * 1000);
  const broadcastToken = generateToken();

  const slotData = {
    stationId: STATION_ID,
    djName: data.djName,
    showName: data.showName || null,
    startTime: startTimestamp,
    endTime: endTimestamp,
    broadcastToken,
    tokenExpiresAt,
    createdAt: Timestamp.now(),
    createdBy: data.createdBy,
    status: 'scheduled',
    broadcastType,
  };

  const docRef = await addDoc(collection(db, COLLECTION), slotData);

  const slot: BroadcastSlotSerialized = {
    id: docRef.id,
    stationId: STATION_ID,
    djName: data.djName,
    showName: data.showName,
    startTime: data.startTime,
    endTime: data.endTime,
    broadcastToken,
    tokenExpiresAt: tokenExpiresAt.toMillis(),
    createdAt: Date.now(),
    createdBy: data.createdBy,
    status: 'scheduled',
    broadcastType,
  };

  // Venue slots use permanent URL, remote slots get unique token URL
  const broadcastUrl = broadcastType === 'venue'
    ? `${process.env.NEXT_PUBLIC_APP_URL || 'https://channel-app.com'}/broadcast/bettertomorrow`
    : `${process.env.NEXT_PUBLIC_APP_URL || 'https://channel-app.com'}/broadcast/live?token=${broadcastToken}`;

  return { slot, broadcastUrl };
}

export async function updateSlot(
  slotId: string,
  updates: Partial<{ status: string; djName: string; showName: string }>
): Promise<void> {
  if (!db) throw new Error('Firestore not initialized');
  await updateDoc(doc(db, COLLECTION, slotId), updates);
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
  const data = docSnap.data();

  const slot: BroadcastSlotSerialized = {
    id: docSnap.id,
    stationId: data.stationId,
    djName: data.djName,
    showName: data.showName,
    startTime: data.startTime?.toMillis() || 0,
    endTime: data.endTime?.toMillis() || 0,
    broadcastToken: data.broadcastToken,
    tokenExpiresAt: data.tokenExpiresAt?.toMillis() || 0,
    createdAt: data.createdAt?.toMillis() || 0,
    createdBy: data.createdBy,
    status: data.status,
    broadcastType: data.broadcastType || 'venue',
  };

  // Check if token has expired
  const now = Date.now();
  if (slot.tokenExpiresAt < now) {
    return { valid: false, error: 'Token has expired' };
  }

  // Check if slot is still valid
  if (slot.status === 'completed' || slot.status === 'missed') {
    return { valid: false, error: 'This broadcast slot has ended' };
  }

  // Determine schedule status
  let scheduleStatus: 'early' | 'on-time' | 'late' = 'on-time';
  let message = 'You are on schedule';

  const fifteenMinutes = 15 * 60 * 1000;

  if (now < slot.startTime - fifteenMinutes) {
    // More than 15 minutes before start
    scheduleStatus = 'early';
    message = `Your show starts at ${new Date(slot.startTime).toLocaleTimeString()}`;
  } else if (now > slot.startTime && now < slot.endTime) {
    // Show has already started but not ended - they're late joining
    scheduleStatus = 'late';
    message = `Your show started at ${new Date(slot.startTime).toLocaleTimeString()}`;
  }
  // Otherwise on-time: within 15 min before start, or after end (token will expire anyway)

  return { valid: true, slot, scheduleStatus, message };
}

// Get current and next venue slots for the venue broadcast page
export async function getVenueSlots(stationId: string = STATION_ID): Promise<{
  currentSlot: BroadcastSlotSerialized | null;
  nextSlot: BroadcastSlotSerialized | null;
}> {
  if (!db) throw new Error('Firestore not initialized');

  const now = Date.now();

  // Find venue slots - query all slots for station and filter by type in memory
  // Uses desc order to match existing index (stationId asc, startTime desc)
  const venueQuery = query(
    collection(db, COLLECTION),
    where('stationId', '==', stationId),
    orderBy('startTime', 'desc')
  );

  const snapshot = await getDocs(venueQuery);
  const slots: BroadcastSlotSerialized[] = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    // Include slots that are venue type OR don't have broadcastType set (legacy)
    const broadcastType = data.broadcastType || 'venue';
    if (broadcastType !== 'venue') return; // Skip remote slots

    slots.push({
      id: doc.id,
      stationId: data.stationId,
      djName: data.djName,
      showName: data.showName,
      startTime: data.startTime?.toMillis() || 0,
      endTime: data.endTime?.toMillis() || 0,
      broadcastToken: data.broadcastToken,
      tokenExpiresAt: data.tokenExpiresAt?.toMillis() || 0,
      createdAt: data.createdAt?.toMillis() || 0,
      createdBy: data.createdBy,
      status: data.status,
      broadcastType,
    });
  });

  // Sort ascending for finding current/next (query returns desc)
  slots.sort((a, b) => a.startTime - b.startTime);

  // Find current slot (now is between start and end)
  const currentSlot = slots.find(
    (slot) => slot.startTime <= now && slot.endTime > now
  ) || null;

  // Find next slot (starts after now)
  const nextSlot = slots.find(
    (slot) => slot.startTime > now
  ) || null;

  return { currentSlot, nextSlot };
}
