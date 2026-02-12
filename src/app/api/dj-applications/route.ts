import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getApplications, createApplication } from '@/lib/dj-applications';
import { DJApplicationFormData } from '@/types/dj-application';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// POST: Create new application
export async function POST(request: NextRequest) {
  try {
    const data: DJApplicationFormData = await request.json();

    // Validate required fields
    if (!data.djName?.trim()) {
      return NextResponse.json({ error: 'DJ name is required' }, { status: 400 });
    }
    if (!data.email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const application = await createApplication(data);

    // Send notification email (fire-and-forget)
    try {
      if (resend) {
        const fields = [
          `<strong>Curator Name:</strong> ${data.djName}`,
          `<strong>Email:</strong> ${data.email}`,
          data.city ? `<strong>City:</strong> ${data.city}` : null,
          data.genre ? `<strong>Genre:</strong> ${data.genre}` : null,
          data.onlineRadioShow ? `<strong>Online Radio Show:</strong> ${data.onlineRadioShow}` : null,
          data.soundcloud ? `<strong>SoundCloud:</strong> ${data.soundcloud}` : null,
          data.instagram ? `<strong>Instagram:</strong> ${data.instagram}` : null,
          data.youtube ? `<strong>YouTube:</strong> ${data.youtube}` : null,
          data.comments ? `<strong>Comments:</strong> ${data.comments}` : null,
        ].filter(Boolean);

        await resend.emails.send({
          from: 'Channel <djshows@channel-app.com>',
          to: 'cap@channel-app.com',
          subject: `New Curator Profile Claim: ${data.djName}`,
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
