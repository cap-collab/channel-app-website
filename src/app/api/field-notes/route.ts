import { NextRequest, NextResponse } from 'next/server';
import { generatePresignedUploadUrl, getR2PublicUrl } from '@/lib/r2-upload';
import { FIELD_NOTES_ADMIN_ONLY } from '@/lib/field-notes-config';
import {
  requireFieldNotesAccess,
  createPendingFieldNote,
  getPublishedFieldNotes,
  ALLOWED_FIELD_NOTE_TYPES,
  getFieldNoteExtension,
} from '@/lib/field-notes';
import { FieldNoteSubmitInput } from '@/types/field-notes';

// GET — public feed of published notes (gated to admins while FIELD_NOTES_ADMIN_ONLY).
export async function GET(request: NextRequest) {
  if (FIELD_NOTES_ADMIN_ONLY) {
    const access = await requireFieldNotesAccess(request, true);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
  }

  try {
    const notes = await getPublishedFieldNotes();
    return NextResponse.json({ notes });
  } catch (error) {
    console.error('[field-notes GET]', error);
    return NextResponse.json({ error: 'Failed to load field notes' }, { status: 500 });
  }
}

// POST — submit/init: validate, mint presigned R2 PUT, create the pending doc.
export async function POST(request: NextRequest) {
  const access = await requireFieldNotesAccess(request, FIELD_NOTES_ADMIN_ONLY);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const { caller } = access;

  try {
    const input = (await request.json()) as FieldNoteSubmitInput;

    if (!input.fileType || !ALLOWED_FIELD_NOTE_TYPES.includes(input.fileType.split(';')[0].trim())) {
      return NextResponse.json({ error: 'Unsupported audio format.' }, { status: 400 });
    }

    const r2PublicUrl = getR2PublicUrl();
    if (!r2PublicUrl) {
      return NextResponse.json({ error: 'Storage not configured.' }, { status: 500 });
    }

    const timestamp = Date.now();
    const ext = getFieldNoteExtension(input.fileType);
    const audioKey = `field-notes/${caller.userId}/${timestamp}.${ext}`;
    const audioUrl = `${r2PublicUrl}/${audioKey}`;

    // Create the pending doc first (validates duration/tags/event link).
    const fieldNoteId = await createPendingFieldNote(
      { userId: caller.userId, username: caller.username, photoUrl: caller.photoUrl },
      input,
      { audioKey, audioUrl, audioMimeType: input.fileType.split(';')[0].trim() }
    );

    const presignedUrl = await generatePresignedUploadUrl(audioKey, input.fileType.split(';')[0].trim());
    if (!presignedUrl) {
      return NextResponse.json({ error: 'Storage not configured.' }, { status: 500 });
    }

    return NextResponse.json({ fieldNoteId, presignedUrl });
  } catch (error) {
    console.error('[field-notes POST]', error);
    const message = error instanceof Error ? error.message : 'Failed to submit field note';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
