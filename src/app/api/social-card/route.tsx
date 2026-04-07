import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://channel-app.com';

// Match ShareableShowCard dimensions: 1080 x 744
const W = 1080;
const LOGO_H = 64;
const INFO_H = 72;
const IMG_H = 608;
const H = LOGO_H + INFO_H + IMG_H;

function getOverlayText(startTime: number): { text: string; isLive: boolean } | null {
  const diff = startTime - Date.now();
  if (diff < 3600_000) {
    return { text: 'LIVE NOW', isLive: true };
  }
  if (diff < 6 * 86400_000) {
    const d = new Date(startTime);
    const day = d.toLocaleDateString('en-US', { weekday: 'long' });
    const hour = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return { text: `LIVE on ${day} ${hour}`, isLive: false };
  }
  return null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const showName = params.get('showName') || 'Untitled Show';
  const djName = params.get('djName') || 'DJ';
  const startTime = Number(params.get('startTime') || 0);
  const imageUrl = params.get('imageUrl') || '';
  const genres = params.get('genres')?.split(',').filter(Boolean) || [];
  const description = params.get('description') || '';

  // Load Geist variable font — same woff used for all weights (Satori handles via fontWeight)
  const fontData = await fetch(new URL('../../../fonts/GeistVF.woff', import.meta.url)).then(r => r.arrayBuffer());

  const overlay = startTime ? getOverlayText(startTime) : null;

  // Truncate description to ~2 lines worth
  const maxDescLen = 120;
  const truncDesc = description.length > maxDescLen
    ? description.slice(0, maxDescLen).trim() + '...'
    : description;

  const genreStr = genres.length > 0
    ? ' - ' + genres.map(g => g.toUpperCase()).join(' \u00B7 ')
    : '';

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#000',
          fontFamily: 'Geist',
        }}
      >
        {/* Logo strip */}
        <div
          style={{
            height: LOGO_H,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${APP_URL}/logo-white.png`}
            alt=""
            height={34}
            style={{ height: 34 }}
          />
          <span style={{ color: '#a1a1aa', fontSize: 32, fontWeight: 500 }}>
            channel-app.com
          </span>
        </div>

        {/* Info strip */}
        <div
          style={{
            height: INFO_H,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          {overlay && (
            <>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  backgroundColor: '#ef4444',
                }}
              />
              {overlay.isLive ? (
                <span style={{ color: '#ef4444', fontSize: 32, fontWeight: 700 }}>
                  LIVE NOW
                </span>
              ) : (
                <div style={{ display: 'flex' }}>
                  <span style={{ color: '#ef4444', fontSize: 32, fontWeight: 700 }}>
                    LIVE
                  </span>
                  <span style={{ color: '#fff', fontSize: 32, fontWeight: 400 }}>
                    {overlay.text.slice(4)}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Hero image area */}
        <div
          style={{
            height: IMG_H,
            position: 'relative',
            display: 'flex',
            overflow: 'hidden',
          }}
        >
          {/* Background image or fallback */}
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: W,
                height: IMG_H,
                objectFit: 'cover',
              }}
            />
          ) : (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: W,
                height: IMG_H,
                backgroundColor: 'rgba(255,255,255,0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span
                style={{
                  color: '#fff',
                  fontSize: 72,
                  fontWeight: 900,
                  textTransform: 'uppercase',
                }}
              >
                {(djName || showName).toUpperCase()}
              </span>
            </div>
          )}

          {/* Top gradient scrim */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: W,
              height: IMG_H,
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 40%)',
            }}
          />

          {/* Bottom gradient scrim */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: W,
              height: IMG_H,
              background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 50%)',
            }}
          />

          {/* Show name — top left */}
          <div
            style={{
              position: 'absolute',
              top: 24,
              left: 24,
              display: 'flex',
            }}
          >
            <span
              style={{
                color: '#fff',
                fontSize: 40,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.025em',
              }}
            >
              {showName.toUpperCase()}
            </span>
          </div>

          {/* Bottom overlay: description + DJ name + genres */}
          <div
            style={{
              position: 'absolute',
              bottom: 24,
              left: 24,
              right: 24,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {truncDesc && (
              <span
                style={{
                  color: '#d4d4d8',
                  fontSize: 32,
                  fontWeight: 300,
                  marginBottom: 8,
                }}
              >
                {truncDesc}
              </span>
            )}
            <div style={{ display: 'flex', alignItems: 'baseline' }}>
              <span
                style={{
                  color: '#fff',
                  fontSize: 34,
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {djName.toUpperCase()}
              </span>
              {genreStr && (
                <span
                  style={{
                    color: '#d4d4d8',
                    fontSize: 34,
                    fontWeight: 500,
                    letterSpacing: '0.15em',
                  }}
                >
                  {genreStr}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: 'Geist', data: fontData, weight: 300 as const, style: 'normal' as const },
        { name: 'Geist', data: fontData, weight: 700 as const, style: 'normal' as const },
        { name: 'Geist', data: fontData, weight: 900 as const, style: 'normal' as const },
      ],
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    },
  );
}
