import { NextRequest, NextResponse } from 'next/server';
import { getApplication, updateApplicationStatus } from '@/lib/dj-applications';
import { getAdminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
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

    // When approving, ensure DJ role is pre-assigned or pending
    if (status === 'approved') {
      const db = getAdminDb();
      if (db) {
        const email = application.email.toLowerCase();

        // Check if user already exists
        const usersSnapshot = await db.collection('users')
          .where('email', '==', application.email)
          .limit(1)
          .get();

        if (!usersSnapshot.empty) {
          // User exists — assign DJ role directly (if not higher)
          const userDoc = usersSnapshot.docs[0];
          const userData = userDoc.data();
          const currentRole = userData.role;
          if (!currentRole || currentRole === 'user') {
            await userDoc.ref.update({
              role: 'dj',
              djTermsAcceptedAt: Timestamp.now(),
            });
            console.log(`[approve-patch] Assigned DJ role to existing user ${userDoc.id}`);
          }
        } else {
          // User doesn't exist yet — create pending-dj-roles entry
          // so they auto-get DJ role when they sign up
          const existingPending = await db.collection('pending-dj-roles')
            .where('email', '==', email)
            .limit(1)
            .get();

          if (existingPending.empty) {
            await db.collection('pending-dj-roles').add({
              email,
              djName: application.djName,
              djTermsAcceptedAt: Timestamp.now(),
              createdAt: Timestamp.now(),
              applicationId: id,
            });
            console.log(`[approve-patch] Created pending-dj-role for ${email}`);
          }
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating DJ application:', error);
    return NextResponse.json({ error: 'Failed to update application' }, { status: 500 });
  }
}
