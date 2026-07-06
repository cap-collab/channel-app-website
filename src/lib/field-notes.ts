import { NextRequest } from 'next/server';
import { getAdminDb, getAdminAuth } from './firebase-admin';
import { normalizeUsername } from './dj-matching';
import { MAX_FIELD_NOTE_DURATION_SEC } from './field-notes-config';
import {
  FieldNoteSerialized,
  FieldNoteStatus,
  FieldNoteSubmitInput,
} from '@/types/field-notes';
import { EventDJRef, EventVenueRef, CollectiveRef } from '@/types/events';

const COLLECTION = 'field-notes';

// Field notes accept ANY audio or video the browser/OS produces — the only
// hard limit is length (<=90s), enforced separately. We don't whitelist exact
// subtypes because phones emit many (video/quicktime, video/3gpp,
// audio/x-m4a, etc.). Just require the top-level type to be audio or video.
export function isAllowedFieldNoteType(mimeType: string): boolean {
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  return base.startsWith('audio/') || base.startsWith('video/');
}

export function getFieldNoteExtension(mimeType: string): string {
  // Strip any codecs parameter, e.g. "audio/webm;codecs=opus" → "audio/webm".
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/3gpp': '3gp',
    'video/x-matroska': 'mkv',
    'video/ogg': 'ogv',
  };
  if (map[base]) return map[base];
  // Fallback: use the subtype (e.g. "video/x-foo" → "foo"), stripped of x- and
  // any suffix, defaulting sensibly by top-level type.
  const sub = base.split('/')[1]?.replace(/^x-/, '').replace(/[^a-z0-9]/g, '');
  if (sub) return sub.slice(0, 5);
  return base.startsWith('video/') ? 'mp4' : 'webm';
}

// Firestore rejects `undefined`; strip undefined keys from a ref object.
function cleanRef<T extends Record<string, unknown>>(d: T): T {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v !== undefined) cleaned[k] = v;
  }
  return cleaned as T;
}

function normalizeDjs(djs?: EventDJRef[]): EventDJRef[] {
  if (!Array.isArray(djs)) return [];
  return djs
    .filter((d) => d && typeof d.djName === 'string' && d.djName.trim().length > 0)
    .map((d) => cleanRef({
      djName: d.djName.trim(),
      djUserId: d.djUserId || undefined,
      djUsername: d.djUsername || undefined,
      djPhotoUrl: d.djPhotoUrl || undefined,
    }));
}

// Keep any venue with a name. A free-text (not-in-DB) venue has no venueId — we
// store venueId: '' so it round-trips as a name-only tag the admin can link later.
function normalizeVenues(venues?: EventVenueRef[]): EventVenueRef[] {
  if (!Array.isArray(venues)) return [];
  return venues
    .filter((v) => v && typeof v.venueName === 'string' && v.venueName.trim().length > 0)
    .map((v) => ({ venueId: v.venueId || '', venueName: v.venueName.trim() }));
}

// Same for collectives — keep name-only entries (collectiveId: '').
function normalizeCollectives(collectives?: CollectiveRef[]): CollectiveRef[] {
  if (!Array.isArray(collectives)) return [];
  return collectives
    .filter((c) => c && typeof c.collectiveName === 'string' && c.collectiveName.trim().length > 0)
    .map((c) => cleanRef({
      collectiveId: c.collectiveId || '',
      collectiveName: c.collectiveName.trim(),
      collectiveSlug: c.collectiveSlug || undefined,
      collectivePhoto: c.collectivePhoto ?? null,
    }));
}

// Stable key for a DJ tag: prefer the uid, else the normalized name.
export function djKey(d: EventDJRef): string {
  return d.djUserId || normalizeUsername(d.djName || '');
}

// Stable key for a venue/collective tag: prefer the id, else the normalized name.
function venueKey(v: EventVenueRef): string {
  return v.venueId || normalizeUsername(v.venueName || '');
}
function collectiveKey(c: CollectiveRef): string {
  return c.collectiveId || normalizeUsername(c.collectiveName || '');
}

function deriveTaggedKeys(
  djs: EventDJRef[],
  venues: EventVenueRef[],
  collectives: CollectiveRef[]
): { taggedDjKeys: string[]; taggedVenueIds: string[]; taggedCollectiveIds: string[] } {
  return {
    taggedDjKeys: Array.from(new Set(djs.map(djKey).filter(Boolean))),
    taggedVenueIds: Array.from(new Set(venues.map(venueKey).filter(Boolean))),
    taggedCollectiveIds: Array.from(new Set(collectives.map(collectiveKey).filter(Boolean))),
  };
}

function serializeFieldNote(id: string, data: Record<string, unknown>): FieldNoteSerialized {
  return {
    id,
    recordedByUserId: data.recordedByUserId as string,
    recordedByUsername: data.recordedByUsername as string,
    recordedByPhotoUrl: (data.recordedByPhotoUrl as string | null) ?? null,
    audioUrl: data.audioUrl as string,
    audioKey: data.audioKey as string,
    audioMimeType: data.audioMimeType as string,
    durationSec: (data.durationSec as number) || 0,
    linkedSlotId: (data.linkedSlotId as string | null) ?? null,
    linkedArchiveId: (data.linkedArchiveId as string | null) ?? null,
    linkedEventId: (data.linkedEventId as string | null) ?? null,
    eventName: (data.eventName as string | null) ?? null,
    eventDate: (data.eventDate as number | null) ?? null,
    djs: (data.djs as EventDJRef[]) || [],
    venues: (data.venues as EventVenueRef[]) || [],
    collectives: (data.collectives as CollectiveRef[]) || [],
    taggedDjKeys: (data.taggedDjKeys as string[]) || [],
    taggedVenueIds: (data.taggedVenueIds as string[]) || [],
    taggedCollectiveIds: (data.taggedCollectiveIds as string[]) || [],
    city: (data.city as string) || '',
    caption: (data.caption as string | null) ?? null,
    transcript: (data.transcript as string | null) ?? null,
    upvotes: (data.upvotes as number) || 0,
    downvotes: (data.downvotes as number) || 0,
    parentNoteId: (data.parentNoteId as string | null) ?? null,
    usagePermission: (data.usagePermission as boolean) ?? false,
    status: data.status as FieldNoteStatus,
    uploadStatus: (data.uploadStatus as 'uploading' | 'ready') || 'ready',
    createdAt: (data.createdAt as number) || 0,
    publishedAt: (data.publishedAt as number | null) ?? null,
    reviewedBy: (data.reviewedBy as string | null) ?? null,
    rejectionReason: (data.rejectionReason as string | null) ?? null,
    adminNotes: (data.adminNotes as string | null) ?? null,
  };
}

// Strip admin-only fields before returning a note to non-admin surfaces.
function stripAdminFields(note: FieldNoteSerialized): FieldNoteSerialized {
  return { ...note, adminNotes: null, reviewedBy: null };
}

// ---- Reads ----------------------------------------------------------------

// Admin list: all notes, newest first.
export async function getFieldNotes(status?: FieldNoteStatus): Promise<FieldNoteSerialized[]> {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore not initialized');

  let query = db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(500);
  if (status) query = db.collection(COLLECTION).where('status', '==', status).orderBy('createdAt', 'desc').limit(500);

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => serializeFieldNote(doc.id, doc.data()));
}

// Public feed: published + ready notes, newest published first. Admin fields
// stripped. When viewerId is given, fills each note's `myVote` with that user's
// vote (so the UI can highlight the selected button).
export async function getPublishedFieldNotes(max = 200, viewerId?: string | null): Promise<FieldNoteSerialized[]> {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore not initialized');

  const snapshot = await db
    .collection(COLLECTION)
    .where('status', '==', 'published')
    .orderBy('publishedAt', 'desc')
    .limit(max)
    .get();

  const notes = snapshot.docs
    .map((doc) => serializeFieldNote(doc.id, doc.data()))
    .filter((n) => n.uploadStatus === 'ready')
    .map(stripAdminFields);

  if (viewerId) {
    await Promise.all(
      notes.map(async (n) => {
        const v = await db.collection(COLLECTION).doc(n.id).collection('votes').doc(viewerId).get();
        n.myVote = v.exists ? ((v.data()?.value as 1 | -1) || 0) : 0;
      })
    );
  }

  return notes;
}

// Cast/toggle a vote. value: 1 (up), -1 (down), or 0 (clear). One vote per user;
// re-voting the same direction clears it. Counts are kept denormalized on the
// note doc via a transaction.
export async function voteOnFieldNote(noteId: string, userId: string, value: 1 | -1 | 0): Promise<{ upvotes: number; downvotes: number; myVote: 1 | -1 | 0 }> {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore not initialized');

  const noteRef = db.collection(COLLECTION).doc(noteId);
  const voteRef = noteRef.collection('votes').doc(userId);

  return db.runTransaction(async (tx) => {
    const [noteSnap, voteSnap] = await Promise.all([tx.get(noteRef), tx.get(voteRef)]);
    if (!noteSnap.exists) throw new Error('Field note not found');
    const data = noteSnap.data()!;
    let up = (data.upvotes as number) || 0;
    let down = (data.downvotes as number) || 0;
    const prev = voteSnap.exists ? ((voteSnap.data()?.value as 1 | -1) || 0) : 0;

    // Toggle: clicking the same direction again clears the vote.
    const next: 1 | -1 | 0 = prev === value ? 0 : value;

    // Remove the previous vote's effect.
    if (prev === 1) up -= 1;
    else if (prev === -1) down -= 1;
    // Apply the new vote.
    if (next === 1) up += 1;
    else if (next === -1) down += 1;

    up = Math.max(0, up);
    down = Math.max(0, down);

    tx.update(noteRef, { upvotes: up, downvotes: down });
    if (next === 0) tx.delete(voteRef);
    else tx.set(voteRef, { value: next, updatedAt: Date.now() });

    return { upvotes: up, downvotes: down, myVote: next };
  });
}

// The author's own notes (any status), newest first. Admin fields stripped
// (but rejectionReason is kept so the author sees why).
export async function getFieldNotesByAuthor(userId: string): Promise<FieldNoteSerialized[]> {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore not initialized');

  const snapshot = await db
    .collection(COLLECTION)
    .where('recordedByUserId', '==', userId)
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();

  return snapshot.docs
    .map((doc) => serializeFieldNote(doc.id, doc.data()))
    .map(stripAdminFields);
}

export async function getFieldNote(id: string): Promise<FieldNoteSerialized | null> {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore not initialized');
  const docSnap = await db.collection(COLLECTION).doc(id).get();
  if (!docSnap.exists) return null;
  return serializeFieldNote(docSnap.id, docSnap.data() || {});
}

// ---- Writes ---------------------------------------------------------------

export interface CreatePendingResult {
  id: string;
  audioKey: string;
  audioUrl: string;
}

// Validate + create a pending field note (uploadStatus 'uploading'). The caller
// supplies the pre-computed R2 key/url (built after presign) so the doc and the
// presigned PUT target stay in lockstep.
export async function createPendingFieldNote(
  author: { userId: string; username: string; photoUrl?: string | null } | null,
  input: FieldNoteSubmitInput,
  audio: { audioKey: string; audioUrl: string; audioMimeType: string }
): Promise<string> {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore not initialized');

  const durationSec = Math.ceil(Number(input.durationSec) || 0);
  if (durationSec <= 0) throw new Error('Could not determine recording duration.');
  if (durationSec > MAX_FIELD_NOTE_DURATION_SEC) {
    throw new Error(`Field notes must be ${MAX_FIELD_NOTE_DURATION_SEC} seconds or shorter.`);
  }

  const djs = normalizeDjs(input.djs);
  const venues = normalizeVenues(input.venues);
  const collectives = normalizeCollectives(input.collectives);

  // Attribution is optional. A note tied to no event and no DJ/venue/collective
  // is filed as "overheard" (derived from the empty attribution, not a stored
  // flag). Only the recording itself is required.

  const { taggedDjKeys, taggedVenueIds, taggedCollectiveIds } = deriveTaggedKeys(djs, venues, collectives);

  const docRef = await db.collection(COLLECTION).add({
    recordedByUserId: author?.userId ?? null,
    recordedByUsername: author?.username ?? 'Anonymous',
    recordedByPhotoUrl: author?.photoUrl ?? null,

    audioUrl: audio.audioUrl,
    audioKey: audio.audioKey,
    audioMimeType: audio.audioMimeType,
    durationSec,

    linkedSlotId: input.linkedSlotId || null,
    linkedArchiveId: input.linkedArchiveId || null,
    linkedEventId: input.linkedEventId || null,
    eventName: input.eventName?.trim() || null,
    eventDate: typeof input.eventDate === 'number' ? input.eventDate : null,

    djs,
    venues,
    collectives,
    taggedDjKeys,
    taggedVenueIds,
    taggedCollectiveIds,

    city: input.city?.trim() || '',
    caption: input.caption?.trim() || null,
    transcript: null,

    upvotes: 0,
    downvotes: 0,
    parentNoteId: input.parentNoteId || null,
    usagePermission: input.usagePermission === true,

    status: 'pending' as FieldNoteStatus,
    uploadStatus: 'uploading',
    createdAt: Date.now(),
    publishedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    adminNotes: null,
  });

  return docRef.id;
}

// After the client PUTs the blob to R2, flip uploadStatus to 'ready'. userId is
// null for anonymous submissions; when the note has an owner, verify it matches.
export async function markFieldNoteReady(
  id: string,
  userId: string | null,
  fileExists: (key: string) => Promise<boolean>
): Promise<void> {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore not initialized');

  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Field note not found');
  const data = snap.data()!;
  if (data.recordedByUserId && data.recordedByUserId !== userId) throw new Error('Not authorized');
  if (data.uploadStatus !== 'uploading') throw new Error('Field note is not in uploading state');

  const exists = await fileExists(data.audioKey as string);
  if (!exists) throw new Error('Upload could not be verified. Please try again.');

  await ref.update({ uploadStatus: 'ready' });
}

// Admin update: status change (publish/reject) and/or tag edits. Any time.
export interface FieldNotePatch {
  status?: FieldNoteStatus;
  rejectionReason?: string | null;
  adminNotes?: string | null;
  djs?: EventDJRef[];
  venues?: EventVenueRef[];
  collectives?: CollectiveRef[];
  linkedSlotId?: string | null;
  linkedArchiveId?: string | null;
  linkedEventId?: string | null;
  eventName?: string | null;
  eventDate?: number | null;
}

export async function updateFieldNote(
  id: string,
  patch: FieldNotePatch,
  reviewedBy: string
): Promise<void> {
  const db = getAdminDb();
  if (!db) throw new Error('Firestore not initialized');

  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Field note not found');

  const update: Record<string, unknown> = {};

  // Tag edits — if any tag field is present, re-derive the flat key arrays.
  const tagsTouched =
    patch.djs !== undefined || patch.venues !== undefined || patch.collectives !== undefined;
  if (tagsTouched) {
    const cur = snap.data()!;
    const djs = patch.djs !== undefined ? normalizeDjs(patch.djs) : ((cur.djs as EventDJRef[]) || []);
    const venues = patch.venues !== undefined ? normalizeVenues(patch.venues) : ((cur.venues as EventVenueRef[]) || []);
    const collectives = patch.collectives !== undefined ? normalizeCollectives(patch.collectives) : ((cur.collectives as CollectiveRef[]) || []);
    update.djs = djs;
    update.venues = venues;
    update.collectives = collectives;
    const keys = deriveTaggedKeys(djs, venues, collectives);
    update.taggedDjKeys = keys.taggedDjKeys;
    update.taggedVenueIds = keys.taggedVenueIds;
    update.taggedCollectiveIds = keys.taggedCollectiveIds;
  }

  if (patch.linkedSlotId !== undefined) update.linkedSlotId = patch.linkedSlotId || null;
  if (patch.linkedArchiveId !== undefined) update.linkedArchiveId = patch.linkedArchiveId || null;
  if (patch.linkedEventId !== undefined) update.linkedEventId = patch.linkedEventId || null;
  if (patch.eventName !== undefined) update.eventName = patch.eventName?.trim() || null;
  if (patch.eventDate !== undefined) update.eventDate = typeof patch.eventDate === 'number' ? patch.eventDate : null;
  if (patch.adminNotes !== undefined) update.adminNotes = patch.adminNotes || null;

  if (patch.status !== undefined) {
    if (patch.status === 'rejected' && !(patch.rejectionReason && patch.rejectionReason.trim())) {
      throw new Error('A rejection reason is required.');
    }
    update.status = patch.status;
    update.reviewedBy = reviewedBy;
    if (patch.status === 'published') {
      update.publishedAt = Date.now();
      update.rejectionReason = null;
    } else if (patch.status === 'rejected') {
      update.rejectionReason = patch.rejectionReason!.trim();
      update.publishedAt = null;
    }
  } else if (patch.rejectionReason !== undefined) {
    update.rejectionReason = patch.rejectionReason?.trim() || null;
  }

  if (Object.keys(update).length === 0) return;
  await ref.update(update);
}

// ---- Auth -----------------------------------------------------------------

export interface FieldNotesCaller {
  userId: string;
  role?: string;
  username: string;
  photoUrl?: string | null;
}

function isBroadcasterRole(role?: string): boolean {
  return role === 'broadcaster' || role === 'admin';
}

// Resolve + authenticate the caller from a Bearer token. When `requireAdmin`
// is true (the testing gate), the caller must have admin-dashboard access.
export async function requireFieldNotesAccess(
  request: NextRequest,
  requireAdmin: boolean
): Promise<{ ok: true; caller: FieldNotesCaller } | { ok: false; status: number; error: string }> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Sign in required' };
  }

  const auth = getAdminAuth();
  const db = getAdminDb();
  if (!auth || !db) return { ok: false, status: 500, error: 'Server not configured' };

  let uid: string;
  try {
    const decoded = await auth.verifyIdToken(authHeader.slice(7));
    uid = decoded.uid;
  } catch {
    return { ok: false, status: 401, error: 'Invalid session' };
  }

  const userDoc = await db.collection('users').doc(uid).get();
  const userData = userDoc.data() || {};
  const role = userData.role as string | undefined;

  if (requireAdmin && !isBroadcasterRole(role)) {
    return { ok: false, status: 403, error: 'Field Notes is not available yet.' };
  }

  const username =
    (userData.chatUsername as string) ||
    (userData.displayName as string) ||
    'Listener';

  return {
    ok: true,
    caller: {
      userId: uid,
      role,
      username,
      photoUrl: (userData.djProfile?.photoUrl as string) || (userData.photoURL as string) || null,
    },
  };
}

// Resolve the caller for the SUBMIT flow, where login is optional (anonymous
// notes are allowed). Returns the logged-in caller when a valid token is
// present, else an anonymous caller. While the admin testing gate is on,
// still blocks non-admins (the whole feature is admin-only until launch).
export async function resolveSubmitCaller(
  request: NextRequest,
  requireAdmin: boolean
): Promise<{ ok: true; caller: FieldNotesCaller | null } | { ok: false; status: number; error: string }> {
  const authHeader = request.headers.get('authorization');
  const db = getAdminDb();
  const auth = getAdminAuth();
  if (!db || !auth) return { ok: false, status: 500, error: 'Server not configured' };

  // No token → anonymous. Only allowed when the admin gate is OFF.
  if (!authHeader?.startsWith('Bearer ')) {
    if (requireAdmin) return { ok: false, status: 403, error: 'Field Notes is not available yet.' };
    return { ok: true, caller: null };
  }

  // Token present → resolve the user (and enforce the admin gate if on).
  try {
    const decoded = await auth.verifyIdToken(authHeader.slice(7));
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    const userData = userDoc.data() || {};
    const role = userData.role as string | undefined;
    if (requireAdmin && !isBroadcasterRole(role)) {
      return { ok: false, status: 403, error: 'Field Notes is not available yet.' };
    }
    return {
      ok: true,
      caller: {
        userId: decoded.uid,
        role,
        username: (userData.chatUsername as string) || (userData.displayName as string) || 'Listener',
        photoUrl: (userData.djProfile?.photoUrl as string) || (userData.photoURL as string) || null,
      },
    };
  } catch {
    // Bad token — treat as anonymous (still gated when admin-only).
    if (requireAdmin) return { ok: false, status: 403, error: 'Field Notes is not available yet.' };
    return { ok: true, caller: null };
  }
}

// Require admin-dashboard access specifically (for the admin list/review routes).
export async function requireBroadcaster(
  request: NextRequest
): Promise<{ ok: true; caller: FieldNotesCaller } | { ok: false; status: number; error: string }> {
  const result = await requireFieldNotesAccess(request, true);
  return result;
}
