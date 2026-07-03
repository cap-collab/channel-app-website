import { NextRequest, NextResponse } from 'next/server';
import { FIELD_NOTES_ADMIN_ONLY } from '@/lib/field-notes-config';
import { requireFieldNotesAccess, getFieldNotesByAuthor } from '@/lib/field-notes';

// GET — the signed-in author's own notes (any status), for the "My notes" section.
export async function GET(request: NextRequest) {
  const access = await requireFieldNotesAccess(request, FIELD_NOTES_ADMIN_ONLY);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const notes = await getFieldNotesByAuthor(access.caller.userId);
    return NextResponse.json({ notes });
  } catch (error) {
    console.error('[field-notes mine]', error);
    return NextResponse.json({ error: 'Failed to load your field notes' }, { status: 500 });
  }
}
