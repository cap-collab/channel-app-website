import { NextRequest, NextResponse } from 'next/server';
import { checkFileExists } from '@/lib/r2-upload';
import { FIELD_NOTES_ADMIN_ONLY } from '@/lib/field-notes-config';
import { requireFieldNotesAccess, markFieldNoteReady } from '@/lib/field-notes';

// POST — finalize: verify the blob landed in R2, flip uploadStatus to 'ready'.
// Deliberately calls NO worker and enqueues NOTHING (no faststart, no
// normalize-queue) — field notes never enter the archive audio pipelines.
export async function POST(request: NextRequest) {
  const access = await requireFieldNotesAccess(request, FIELD_NOTES_ADMIN_ONLY);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const { fieldNoteId } = await request.json();
    if (!fieldNoteId) {
      return NextResponse.json({ error: 'fieldNoteId required' }, { status: 400 });
    }

    await markFieldNoteReady(fieldNoteId, access.caller.userId, checkFileExists);

    return NextResponse.json({ success: true, fieldNoteId });
  } catch (error) {
    console.error('[field-notes complete]', error);
    const message = error instanceof Error ? error.message : 'Failed to complete field note';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
