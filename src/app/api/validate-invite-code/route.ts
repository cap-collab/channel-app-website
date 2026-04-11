import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code) {
      return NextResponse.json({ valid: false }, { status: 400 });
    }

    const validCode = process.env.DJ_INVITE_CODE;
    if (!validCode) {
      console.error('[validate-invite-code] DJ_INVITE_CODE env var not set');
      return NextResponse.json({ valid: false }, { status: 500 });
    }

    const valid = code.trim().toLowerCase() === validCode.trim().toLowerCase();
    return NextResponse.json({ valid });
  } catch {
    return NextResponse.json({ valid: false }, { status: 500 });
  }
}
