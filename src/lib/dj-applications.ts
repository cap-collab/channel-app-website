import { getAdminDb } from './firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { DJApplicationSerialized, DJApplicationFormData, DJApplicationStatus } from '@/types/dj-application';

const COLLECTION = 'dj-applications';

// Helper to serialize an application from Firestore data
function serializeApplication(docId: string, data: Record<string, unknown>): DJApplicationSerialized {
  return {
    id: docId,
    djName: data.djName as string,
    email: data.email as string,
    showName: data.showName as string,
    locationType: data.locationType as 'home' | 'venue',
    venueName: data.venueName as string | undefined,
    soundcloud: data.soundcloud as string | undefined,
    instagram: data.instagram as string | undefined,
    youtube: data.youtube as string | undefined,
    preferredSlots: data.preferredSlots as Array<{ start: number; end: number }>,
    timezone: (data.timezone as string) || 'America/New_York', // Default for legacy data
    comments: data.comments as string | undefined,
    needsSetupSupport: data.needsSetupSupport as boolean | undefined,
    status: data.status as DJApplicationStatus,
    submittedAt: (data.submittedAt as { toMillis: () => number })?.toMillis() || Date.now(),
    adminNotes: data.adminNotes as string | undefined,
    scheduledSlotId: data.scheduledSlotId as string | undefined,
  };
}

export async function getApplications(): Promise<DJApplicationSerialized[]> {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore not initialized');

  const snapshot = await db
    .collection(COLLECTION)
    .orderBy('submittedAt', 'desc')
    .get();

  const applications: DJApplicationSerialized[] = [];

  snapshot.forEach((doc) => {
    applications.push(serializeApplication(doc.id, doc.data()));
  });

  return applications;
}

export async function getApplication(id: string): Promise<DJApplicationSerialized | null> {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore not initialized');

  const docSnap = await db.collection(COLLECTION).doc(id).get();

  if (!docSnap.exists) return null;

  return serializeApplication(docSnap.id, docSnap.data() || {});
}

export async function createApplication(data: DJApplicationFormData): Promise<DJApplicationSerialized> {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore not initialized');

  const docRef = await db.collection(COLLECTION).add({
    djName: data.djName.trim(),
    email: data.email.trim(),
    showName: data.showName.trim(),
    locationType: data.locationType,
    venueName: data.venueName?.trim() || null,
    soundcloud: data.soundcloud?.trim() || null,
    instagram: data.instagram?.trim() || null,
    youtube: data.youtube?.trim() || null,
    preferredSlots: data.preferredSlots,
    timezone: data.timezone,
    comments: data.comments?.trim() || null,
    needsSetupSupport: data.needsSetupSupport || false,
    status: 'pending' as DJApplicationStatus,
    submittedAt: Timestamp.now(),
  });

  const newDoc = await docRef.get();
  return serializeApplication(docRef.id, newDoc.data() || {});
}

export async function updateApplicationStatus(
  id: string,
  status: DJApplicationStatus,
  additionalData?: { adminNotes?: string; scheduledSlotId?: string }
): Promise<void> {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore not initialized');

  const updateData: Record<string, unknown> = { status };
  if (additionalData?.adminNotes) {
    updateData.adminNotes = additionalData.adminNotes;
  }
  if (additionalData?.scheduledSlotId) {
    updateData.scheduledSlotId = additionalData.scheduledSlotId;
  }

  await db.collection(COLLECTION).doc(id).update(updateData);
}
