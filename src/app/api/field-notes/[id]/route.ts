import { NextRequest, NextResponse } from 'next/server';
import { requireBroadcaster, updateFieldNote, getFieldNote, FieldNotePatch } from '@/lib/field-notes';

// GET — admin: fetch a single note (any status).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireBroadcaster(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const { id } = await params;
    const note = await getFieldNote(id);
    if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ note });
  } catch (error) {
    console.error('[field-notes [id] GET]', error);
    return NextResponse.json({ error: 'Failed to load field note' }, { status: 500 });
  }
}

// PATCH — admin: publish/reject and/or edit tags + event on any note.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireBroadcaster(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const { id } = await params;
    const patch = (await request.json()) as FieldNotePatch;
    await updateFieldNote(id, patch, access.caller.userId);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('[field-notes [id] PATCH]', error);
    const message = error instanceof Error ? error.message : 'Failed to update field note';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
