import { NextRequest, NextResponse } from 'next/server';
import { generatePresignedUploadUrl, getR2PublicUrl } from '@/lib/r2-upload';
import {
  resolveSubmitCaller,
  createPendingFieldNote,
  getPublishedFieldNotes,
  isAllowedFieldNoteType,
  getFieldNoteExtension,
} from '@/lib/field-notes';
import { FieldNoteSubmitInput } from '@/types/field-notes';

// GET — public feed of published notes. Open to everyone. When a token is
// present, fills each note's `myVote` so the UI can highlight the user's vote.
export async function GET(request: NextRequest) {
  const access = await resolveSubmitCaller(request, false);
  const viewerId = access.ok ? access.caller?.userId ?? null : null;
  try {
    const notes = await getPublishedFieldNotes(200, viewerId);
    return NextResponse.json({ notes });
  } catch (error) {
    console.error('[field-notes GET]', error);
    return NextResponse.json({ error: 'Failed to load field notes' }, { status: 500 });
  }
}

// POST — submit/init: validate, mint presigned R2 PUT, create the pending doc.
// Login is optional — anonymous submissions are allowed.
export async function POST(request: NextRequest) {
  const access = await resolveSubmitCaller(request, false);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const caller = access.caller; // null when anonymous

  try {
    const input = (await request.json()) as FieldNoteSubmitInput;

    if (!input.fileType || !isAllowedFieldNoteType(input.fileType)) {
      return NextResponse.json({ error: 'Please upload an audio or video file.' }, { status: 400 });
    }

    const r2PublicUrl = getR2PublicUrl();
    if (!r2PublicUrl) {
      return NextResponse.json({ error: 'Storage not configured.' }, { status: 500 });
    }

    const timestamp = Date.now();
    const ext = getFieldNoteExtension(input.fileType);
    const audioKey = `field-notes/${caller?.userId ?? 'anonymous'}/${timestamp}.${ext}`;
    const audioUrl = `${r2PublicUrl}/${audioKey}`;

    // Create the pending doc first (validates duration/tags/event link).
    const fieldNoteId = await createPendingFieldNote(
      caller ? { userId: caller.userId, username: caller.username, photoUrl: caller.photoUrl } : null,
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
