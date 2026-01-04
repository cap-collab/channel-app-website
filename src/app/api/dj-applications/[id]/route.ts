import { NextRequest, NextResponse } from 'next/server';
import { getApplication, updateApplicationStatus } from '@/lib/dj-applications';
import { DJApplicationStatus } from '@/types/dj-application';

// GET: Get single application
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const application = await getApplication(id);

    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }

    return NextResponse.json({ application });
  } catch (error) {
    console.error('Error fetching DJ application:', error);
    return NextResponse.json({ error: 'Failed to fetch application' }, { status: 500 });
  }
}

// PATCH: Update application status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, adminNotes } = body as {
      status: DJApplicationStatus;
      adminNotes?: string;
    };

    if (!status) {
      return NextResponse.json({ error: 'Status is required' }, { status: 400 });
    }

    const validStatuses: DJApplicationStatus[] = ['pending', 'info-requested', 'approved', 'denied'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    // Check if application exists first
    const application = await getApplication(id);
    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }

    await updateApplicationStatus(id, status, adminNotes ? { adminNotes } : undefined);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating DJ application:', error);
    return NextResponse.json({ error: 'Failed to update application' }, { status: 500 });
  }
}
