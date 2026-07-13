import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { FieldValue } from 'firebase-admin/firestore';
import { getApplications, createApplication } from '@/lib/dj-applications';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { getResidentBookingWindow } from '@/lib/resident-booking';
import { DJApplicationFormData } from '@/types/dj-application';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// POST: Create new application
export async function POST(request: NextRequest) {
  try {
    const data: DJApplicationFormData & { source?: string } = await request.json();
    const isShowRequest = data.source === 'show-request';

    // Validate required fields
    if (!data.djName?.trim()) {
      return NextResponse.json({ error: 'DJ name is required' }, { status: 400 });
    }
    if (!data.email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Show requests are the resident self-booking flow (/studio/livestream): only
    // residents may submit one, and their cadence sets how soon after their last
    // show they may book. The form hides earlier dates — enforce it here too, so
    // the rule can't be skipped by posting directly. Open applications from
    // /studio/join (no `source`) are unauthenticated and unaffected.
    if (isShowRequest) {
      const auth = getAdminAuth();
      const adminDb = getAdminDb();
      if (!auth || !adminDb) {
        return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
      }

      const authHeader = request.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      let uid: string;
      try {
        const decoded = await auth.verifyIdToken(authHeader.slice(7));
        uid = decoded.uid;
      } catch {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const window = await getResidentBookingWindow(adminDb, uid);
      if (!window.cadence) {
        return NextResponse.json(
          { error: 'Only residents can book a show from the studio.' },
          { status: 403 },
        );
      }

      // One booking at a time — the studio button already hides in this case, so
      // reaching here means a stale link or a hand-rolled POST.
      if (window.upcomingShowAt) {
        const booked = new Date(window.upcomingShowAt).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        });
        return NextResponse.json(
          {
            error: `You already have a show booked for ${booked}. You can request your next one once it has aired.`,
          },
          { status: 409 },
        );
      }

      const { earliestStart, cooldownDays } = window;
      if (earliestStart) {
        const tooSoon = (data.preferredSlots || []).some((slot) => slot.start < earliestStart);
        if (tooSoon) {
          const earliest = new Date(earliestStart).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          });
          return NextResponse.json(
            {
              error: `As a ${window.cadence} resident, your next show can't start before ${earliest} (${cooldownDays} days after your last show). Please pick a later time.`,
            },
            { status: 400 },
          );
        }
      }
    }

    const application = await createApplication(data);

    // Also add the applicant to the radio-notify-waitlist so they receive
    // the weekly newsletter. Idempotent: skip if email already exists.
    try {
      const db = getAdminDb();
      if (db) {
        const normalizedEmail = data.email.trim().toLowerCase();
        const existing = await db
          .collection('radio-notify-waitlist')
          .where('email', '==', normalizedEmail)
          .limit(1)
          .get();
        if (existing.empty) {
          await db.collection('radio-notify-waitlist').add({
            email: normalizedEmail,
            name: data.djName.trim(),
            ...(data.city && { city: data.city }),
            ...(data.timezone && { timezone: data.timezone }),
            source: 'dj-application',
            marketingOptIn: true,
            submittedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    } catch (waitlistError) {
      console.error('Failed to add applicant to radio-notify-waitlist:', waitlistError);
    }

    // Send notification email (fire-and-forget)
    try {
      if (resend) {
        const fields = [
          `<strong>Curator Name:</strong> ${data.djName}`,
          `<strong>Email:</strong> ${data.email}`,
          data.showName ? `<strong>Show Name:</strong> ${data.showName}` : null,
          data.city ? `<strong>City:</strong> ${data.city}` : null,
          data.genre ? `<strong>Genre:</strong> ${data.genre}` : null,
          data.onlineRadioShow ? `<strong>Online Radio Show:</strong> ${data.onlineRadioShow}` : null,
          data.soundcloud ? `<strong>SoundCloud:</strong> ${data.soundcloud}` : null,
          data.instagram ? `<strong>Instagram:</strong> ${data.instagram}` : null,
          data.youtube ? `<strong>YouTube:</strong> ${data.youtube}` : null,
          data.comments ? `<strong>Comments:</strong> ${data.comments}` : null,
        ].filter(Boolean);

        const subject = isShowRequest
          ? `New show request: ${data.djName}`
          : `New Curator Profile Claim: ${data.djName}`;

        await resend.emails.send({
          from: 'Channel <djshows@channel-app.com>',
          to: 'cap@channel-app.com',
          subject,
          html: `<div style="font-family: sans-serif; line-height: 1.6;">${fields.join('<br/>')}</div>`,
        });
      }
    } catch (emailError) {
      console.error('Failed to send notification email:', emailError);
    }

    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    console.error('Error creating DJ application:', error);
    return NextResponse.json({ error: 'Failed to create application' }, { status: 500 });
  }
}

// GET: List all applications (admin only - auth should be added)
export async function GET() {
  try {
    const applications = await getApplications();
    return NextResponse.json({ applications });
  } catch (error) {
    console.error('Error fetching DJ applications:', error);
    return NextResponse.json({ error: 'Failed to fetch applications' }, { status: 500 });
  }
}
