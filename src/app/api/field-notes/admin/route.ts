import { NextRequest, NextResponse } from 'next/server';
import { requireBroadcaster, getFieldNotes } from '@/lib/field-notes';

// GET — admin list of ALL field notes (any status). Always broadcaster-gated,
// regardless of the public testing flag.
export async function GET(request: NextRequest) {
  const access = await requireBroadcaster(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const notes = await getFieldNotes();
    return NextResponse.json({ notes });
  } catch (error) {
    console.error('[field-notes admin]', error);
    return NextResponse.json({ error: 'Failed to load field notes' }, { status: 500 });
  }
}
