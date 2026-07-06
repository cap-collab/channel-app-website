import { NextRequest, NextResponse } from 'next/server';
import { incrementFieldNoteReached } from '@/lib/field-notes';

// POST — a listener streamed past the 7s mark on this tape. Increments the
// play-through counter. Open to everyone (anonymous included); no body. The
// client fires this at most once per playback.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await incrementFieldNoteReached(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[field-notes reached]', error);
    // Non-fatal for the listener — a dropped count shouldn't surface an error.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
