import { NextRequest, NextResponse } from 'next/server';
import { resolveSubmitCaller, voteOnFieldNote } from '@/lib/field-notes';

// POST — cast/toggle a vote on a note. Requires login (any registered user).
// Body: { value: 1 | -1 | 0 }. Returns updated counts + the caller's vote.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await resolveSubmitCaller(request, false);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  if (!access.caller) {
    return NextResponse.json({ error: 'Sign in to vote.' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { value } = await request.json();
    if (value !== 1 && value !== -1 && value !== 0) {
      return NextResponse.json({ error: 'Invalid vote' }, { status: 400 });
    }
    const result = await voteOnFieldNote(id, access.caller.userId, value);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[field-notes vote]', error);
    const message = error instanceof Error ? error.message : 'Failed to vote';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
