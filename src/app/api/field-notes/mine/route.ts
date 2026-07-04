import { NextRequest, NextResponse } from 'next/server';
import { resolveSubmitCaller, getFieldNotesByAuthor } from '@/lib/field-notes';

// GET — the signed-in author's own notes (any status), for the "My notes"
// section. Logged out → empty (nothing to show, no admin gate).
export async function GET(request: NextRequest) {
  const access = await resolveSubmitCaller(request, false);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  if (!access.caller) {
    return NextResponse.json({ notes: [] });
  }

  try {
    const notes = await getFieldNotesByAuthor(access.caller.userId);
    return NextResponse.json({ notes });
  } catch (error) {
    console.error('[field-notes mine]', error);
    return NextResponse.json({ error: 'Failed to load your field notes' }, { status: 500 });
  }
}
