import { NextRequest, NextResponse } from 'next/server';

const R2_BASE_URL = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const path = params.path.join('/');
  const r2Url = `${R2_BASE_URL}/${path}`;

  try {
    const response = await fetch(r2Url);

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Stream not available' },
        { status: response.status }
      );
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const isManifest = path.endsWith('.m3u8');

    // Stream the response body instead of buffering the entire segment in memory
    const body = response.body;
    if (!body) {
      return NextResponse.json({ error: 'Empty response from origin' }, { status: 502 });
    }

    // Manifests: short cache so players get fresh segment lists quickly
    // Segments (.ts): cache longer since segment content is immutable once written
    const cacheControl = isManifest
      ? 'public, max-age=1, stale-while-revalidate=2'
      : 'public, max-age=60, stale-while-revalidate=120';

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': cacheControl,
        'CDN-Cache-Control': cacheControl,
      },
    });
  } catch (error) {
    console.error('HLS proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stream' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
