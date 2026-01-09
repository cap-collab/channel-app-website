import { NextRequest, NextResponse } from 'next/server';
import { getApplications, createApplication } from '@/lib/dj-applications';
import { DJApplicationFormData } from '@/types/dj-application';

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
    if (!data.showName?.trim()) {
      return NextResponse.json({ error: 'Show name is required' }, { status: 400 });
    }
    if (!data.setDuration || data.setDuration < 0.5 || data.setDuration > 24) {
      return NextResponse.json({ error: 'Set duration must be between 0.5 and 24 hours' }, { status: 400 });
    }
    if ((data.setDuration * 2) % 1 !== 0) {
      return NextResponse.json({ error: 'Set duration must be in 0.5 hour increments' }, { status: 400 });
    }
    if (!data.preferredSlots || data.preferredSlots.length === 0) {
      return NextResponse.json({ error: 'At least one preferred time slot is required' }, { status: 400 });
    }
    if (data.locationType === 'venue' && !data.venueName?.trim()) {
      return NextResponse.json({ error: 'Venue name is required' }, { status: 400 });
    }

    const application = await createApplication(data);

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
