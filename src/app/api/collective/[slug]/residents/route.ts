import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyOwnerAccess } from '@/lib/collective-owner-auth';
import type { EventDJRef } from '@/types/events';

// Structural resident/guest edits for a collective, by an OWNER (self-service).
//
// Owners can't touch residentDJs/guestDJs from the client (the firestore
// cosmetic rule whitelists only display fields), so these array mutations go
// through this owner-authorized route. `role` is never read or written here —
// authorization is pure slug-ownership, orthogonal to DJ roles.

type ListKey = 'resident' | 'guest';

function listField(list: ListKey): 'residentDJs' | 'guestDJs' {
  return list === 'guest' ? 'guestDJs' : 'residentDJs';
}

// Keep only the known EventDJRef fields; drop anything the client tried to smuggle.
// An UNLINKED entry (plain text placeholder) is valid: only djName is required.
function sanitizeEntry(raw: unknown): EventDJRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const djName = typeof r.djName === 'string' ? r.djName.trim() : '';
  if (!djName) return null;
  const entry: EventDJRef = { djName };
  if (typeof r.djUserId === 'string' && r.djUserId) entry.djUserId = r.djUserId;
  if (typeof r.djUsername === 'string' && r.djUsername) entry.djUsername = r.djUsername;
  if (typeof r.djPhotoUrl === 'string' && r.djPhotoUrl) entry.djPhotoUrl = r.djPhotoUrl;
  return entry;
}

// Identity for de-dup / removal. Linked entries match on djUsername; unlinked
// (text-only) entries match on the trimmed lowercased name.
function refKey(ref: EventDJRef): string {
  if (ref.djUsername) return `u:${ref.djUsername.toLowerCase()}`;
  return `n:${ref.djName.trim().toLowerCase()}`;
}

// POST — add a resident or guest.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const access = await verifyOwnerAccess(request, slug);
  if (!access.isOwner || !access.collectiveId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const list: ListKey = body.list === 'guest' ? 'guest' : 'resident';
    const entry = sanitizeEntry(body.entry);
    if (!entry) {
      return NextResponse.json({ error: 'A resident/guest name is required' }, { status: 400 });
    }

    const field = listField(list);
    const collectiveRef = db.collection('collectives').doc(access.collectiveId);

    // Read-modify-write so we can de-dup by identity (arrayUnion is brittle
    // across optional fields — two entries for the same DJ with/without a photo
    // would both be kept).
    const current: EventDJRef[] = Array.isArray(access.collectiveData?.[field])
      ? (access.collectiveData![field] as EventDJRef[])
      : [];
    const key = refKey(entry);
    if (current.some((e) => refKey(e) === key)) {
      return NextResponse.json({ success: true, [field]: current, alreadyPresent: true });
    }
    const next = [...current, entry];
    await collectiveRef.update({ [field]: next });

    return NextResponse.json({ success: true, [field]: next });
  } catch (error) {
    console.error('[collective/residents POST] Error:', error);
    return NextResponse.json({ error: 'Failed to add' }, { status: 500 });
  }
}

// DELETE — remove a resident or guest by identity.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const access = await verifyOwnerAccess(request, slug);
  if (!access.isOwner || !access.collectiveId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const list: ListKey = body.list === 'guest' ? 'guest' : 'resident';
    const entry = sanitizeEntry(body.entry);
    if (!entry) {
      return NextResponse.json({ error: 'A resident/guest to remove is required' }, { status: 400 });
    }

    const field = listField(list);
    const collectiveRef = db.collection('collectives').doc(access.collectiveId);

    const current: EventDJRef[] = Array.isArray(access.collectiveData?.[field])
      ? (access.collectiveData![field] as EventDJRef[])
      : [];
    const key = refKey(entry);
    const next = current.filter((e) => refKey(e) !== key);
    await collectiveRef.update({ [field]: next });

    return NextResponse.json({ success: true, [field]: next });
  } catch (error) {
    console.error('[collective/residents DELETE] Error:', error);
    return NextResponse.json({ error: 'Failed to remove' }, { status: 500 });
  }
}
