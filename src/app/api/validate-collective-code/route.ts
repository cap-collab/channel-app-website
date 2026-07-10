import { NextRequest, NextResponse } from 'next/server';

// Mirror of /api/validate-invite-code for the collective funnel. A single shared
// secret gates the funnel; WHICH collective a person gets is set separately by
// admin (email-bound pending-collective-roles), so this endpoint only checks the
// generic gate.
export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code) {
      return NextResponse.json({ valid: false }, { status: 400 });
    }

    const validCode = process.env.COLLECTIVE_INVITE_CODE;
    if (!validCode) {
      console.error('[validate-collective-code] COLLECTIVE_INVITE_CODE env var not set');
      return NextResponse.json({ valid: false }, { status: 500 });
    }

    const valid = code.trim().toLowerCase() === validCode.trim().toLowerCase();
    return NextResponse.json({ valid });
  } catch {
    return NextResponse.json({ valid: false }, { status: 500 });
  }
}
