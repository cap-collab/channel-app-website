import type { Firestore, DocumentData } from 'firebase-admin/firestore';

function normalizeName(name: string): string {
  return name.replace(/[\s-]+/g, '').toLowerCase();
}

type DJProfileSource = {
  djUserId: string | null;
  djUsername: string | null;
  djEmail: string | null;
  bio: string | null;
  photoUrl: string | null;
  genres: string[] | null;
  description: string | null;
  tipButtonLink: string | null;
  bandcamp: string | null;
  thankYouMessage: string | null;
};

function extractFromUser(userId: string, userData: DocumentData): DJProfileSource {
  const djProfile = userData.djProfile || {};
  return {
    djUserId: userId,
    djUsername: userData.chatUsername || null,
    djEmail: userData.email || null,
    bio: djProfile.bio || null,
    photoUrl: djProfile.photoUrl || null,
    genres: djProfile.genres || null,
    description: djProfile.description || djProfile.bio || null,
    tipButtonLink: djProfile.tipButtonLink || null,
    bandcamp: djProfile.bandcamp || djProfile.socialLinks?.bandcamp || null,
    thankYouMessage: djProfile.thankYouMessage || null,
  };
}

function extractFromPending(data: DocumentData): DJProfileSource {
  const djProfile = data.djProfile || {};
  return {
    djUserId: null,
    djUsername: data.chatUsername || null,
    djEmail: data.email || null,
    bio: djProfile.bio || null,
    photoUrl: djProfile.photoUrl || null,
    genres: djProfile.genres || null,
    description: djProfile.description || djProfile.bio || null,
    tipButtonLink: djProfile.tipButtonLink || null,
    bandcamp: djProfile.bandcamp || djProfile.socialLinks?.bandcamp || null,
    thankYouMessage: djProfile.thankYouMessage || null,
  };
}

async function resolveDJProfile(db: Firestore, slot: DocumentData): Promise<DJProfileSource | null> {
  const djUserId = slot.djUserId as string | undefined;
  const djEmail = slot.djEmail as string | undefined;
  const djName = slot.djName as string | undefined;

  if (djUserId) {
    const userDoc = await db.collection('users').doc(djUserId).get();
    if (userDoc.exists) return extractFromUser(userDoc.id, userDoc.data()!);
  }

  if (djEmail) {
    const snap = await db.collection('users').where('email', '==', djEmail).limit(1).get();
    if (!snap.empty) return extractFromUser(snap.docs[0].id, snap.docs[0].data());
  }

  if (djName) {
    const normalized = normalizeName(djName);
    if (normalized) {
      const userSnap = await db
        .collection('users')
        .where('chatUsernameNormalized', '==', normalized)
        .limit(1)
        .get();
      if (!userSnap.empty) return extractFromUser(userSnap.docs[0].id, userSnap.docs[0].data());

      const pendingSnap = await db
        .collection('pending-dj-profiles')
        .where('chatUsernameNormalized', '==', normalized)
        .limit(1)
        .get();
      if (!pendingSnap.empty) return extractFromPending(pendingSnap.docs[0].data());
    }
  }

  if (djEmail) {
    const pendingSnap = await db
      .collection('pending-dj-profiles')
      .where('email', '==', djEmail.toLowerCase())
      .limit(1)
      .get();
    if (!pendingSnap.empty) return extractFromPending(pendingSnap.docs[0].data());
  }

  return null;
}

// Pull the DJ's current profile from Firestore and write changed liveDj* fields
// onto the slot. Used right before the 2h reminder email so emails and the
// live hero both see the freshest photo/bio.
export async function refreshSlotDJProfile(
  db: Firestore,
  slotDoc: FirebaseFirestore.QueryDocumentSnapshot,
): Promise<{ updated: boolean; fields: string[] }> {
  const slot = slotDoc.data();

  if (!slot.djName && !slot.djEmail && !slot.djUserId) {
    return { updated: false, fields: [] };
  }

  const profile = await resolveDJProfile(db, slot);
  if (!profile) return { updated: false, fields: [] };

  const next: Record<string, unknown> = {};
  if (profile.djUserId && slot.djUserId !== profile.djUserId) next.djUserId = profile.djUserId;
  if (profile.djUsername && slot.djUsername !== profile.djUsername) next.djUsername = profile.djUsername;
  if (profile.djEmail && !slot.djEmail) next.djEmail = profile.djEmail;
  if (profile.bio !== slot.liveDjBio) next.liveDjBio = profile.bio;
  if (profile.photoUrl !== slot.liveDjPhotoUrl) next.liveDjPhotoUrl = profile.photoUrl;
  if (profile.genres && !slot.liveDjGenres) next.liveDjGenres = profile.genres;
  if (profile.description && !slot.liveDjDescription) next.liveDjDescription = profile.description;
  if (profile.tipButtonLink && !slot.liveDjTipButtonLink) next.liveDjTipButtonLink = profile.tipButtonLink;
  if (profile.bandcamp && !slot.liveDjBandcamp) next.liveDjBandcamp = profile.bandcamp;
  if (profile.thankYouMessage && !slot.liveDjThankYouMessage) next.liveDjThankYouMessage = profile.thankYouMessage;

  if (Object.keys(next).length === 0) return { updated: false, fields: [] };

  await slotDoc.ref.update(next);
  return { updated: true, fields: Object.keys(next) };
}
