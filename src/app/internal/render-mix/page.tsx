'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { SceneGlyph } from '@/components/SceneGlyph';

type RenderData = {
  showName: string;
  djName: string;
  djPhotoUrl: string;
  djGenres: string[];
  djDescription: string | null;
  durationSec: number;
  sceneSlug: string | null;
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function parseRenderData(raw: string | null): RenderData | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (
      typeof obj.showName === 'string' &&
      typeof obj.djName === 'string' &&
      typeof obj.djPhotoUrl === 'string' &&
      Array.isArray(obj.djGenres) &&
      typeof obj.durationSec === 'number' &&
      obj.durationSec > 0
    ) {
      return {
        showName: obj.showName,
        djName: obj.djName,
        djPhotoUrl: obj.djPhotoUrl,
        djGenres: obj.djGenres.filter((g: unknown): g is string => typeof g === 'string'),
        djDescription: typeof obj.djDescription === 'string' && obj.djDescription.length > 0 ? obj.djDescription : null,
        durationSec: obj.durationSec,
        sceneSlug: typeof obj.sceneSlug === 'string' && obj.sceneSlug.length > 0 ? obj.sceneSlug : null,
      };
    }
  } catch {
    // fall through
  }
  return null;
}

function SelfDrivingProgressBar({ durationSec }: { durationSec: number }) {
  const startedAt = useMemo(() => Date.now(), []);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const p = Math.max(0, Math.min(1, elapsed / durationSec));
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startedAt, durationSec]);

  return (
    <div className="relative w-full h-[3px] bg-white/10">
      <div className="absolute inset-y-0 left-0 bg-white" style={{ width: `${progress * 100}%` }} />
    </div>
  );
}

/**
 * Static (no-scroll) overlay used only on the YouTube render page.
 * Truncation rules per Cap:
 *   - DJ name: single-line, truncated with ellipsis
 *   - Genres: always on their own line below DJ name, truncated
 *   - Bio: max 5 lines, ellipsis after
 */
function RenderMixHeroOverlay({
  djName,
  djGenres,
  djDescription,
}: {
  djName: string;
  djGenres: string[];
  djDescription: string | null;
}) {
  const genreText = djGenres.length > 0 ? djGenres.join(' · ') : null;
  // Sizes are ~15% bigger than /radio's DJImageOverlay (Cap's request for
  // the YouTube render). /radio uses text-xs (12px) / text-[10px] /
  // text-[11px]; render-mix uses 14px / 11.5px / 12.65px.
  return (
    <div>
      <div className="text-sm font-black uppercase tracking-wider text-white truncate">
        {djName}
      </div>
      {genreText && (
        <div
          className="font-medium uppercase tracking-[0.15em] text-zinc-300 truncate mt-0.5"
          style={{ fontSize: '11.5px' }}
        >
          {genreText}
        </div>
      )}
      {djDescription && (
        <div
          className="mt-1 leading-[1.3em] text-zinc-300 font-light line-clamp-5"
          style={{ fontSize: '12.65px' }}
        >
          {djDescription}
        </div>
      )}
    </div>
  );
}

function RenderMixInner() {
  const searchParams = useSearchParams();
  const data = useMemo(() => parseRenderData(searchParams.get('data')), [searchParams]);
  // Variant: 'square' renders a 1500×1500 SoundCloud cover instead of the
  // default 1920×1080 YouTube frame. Same content (photo, show, DJ name,
  // genres, bio) but no player chrome / progress bar — covers are static.
  const variant = searchParams.get('variant') === 'square' ? 'square' : 'youtube';

  // The render-mix page is fully static — no scrolling text, no animated
  // bars. We always tell the worker to take the static-screenshot path.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.dataset.needsMotion = 'false';
  }, []);

  if (!data) {
    // No params = not a real render request. Stay blank — this URL is not
    // user-facing and shouldn't render anything discoverable.
    return <div className="w-screen h-screen bg-black" />;
  }

  if (variant === 'square') {
    return <SquareCover data={data} />;
  }

  // The hero components (DJImageOverlay, ScrollingShowName, etc.) were sized
  // against /radio's ~768px-wide hero. We render the image+overlays+player
  // block at that reference width and scale it up to fill the full 1920px
  // frame so every internal proportion (text, padding, bio scroll speed)
  // matches /radio exactly while filling the YouTube canvas with no black
  // borders. The image goes object-cover at the frame's actual aspect ratio.
  const FRAME_WIDTH = 1920;
  const FRAME_HEIGHT = 1080;
  const REFERENCE_WIDTH = 768;
  const SCALE = FRAME_WIDTH / REFERENCE_WIDTH; // 2.5×
  const REFERENCE_HEIGHT = Math.round(FRAME_HEIGHT / SCALE); // 432

  return (
    <div
      className="bg-black relative overflow-hidden"
      style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT }}
    >
      <div
        style={{
          width: REFERENCE_WIDTH,
          height: REFERENCE_HEIGHT,
          transform: `scale(${SCALE})`,
          transformOrigin: 'top left',
        }}
        className="relative"
      >
        {/* DJ photo fills the full frame */}
        <Image
          src={data.djPhotoUrl}
          alt={data.djName}
          fill
          className="object-cover"
          sizes={`${REFERENCE_WIDTH}px`}
          priority
          unoptimized
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80" />
        <div className="absolute top-2 left-2 drop-shadow-lg">
          {/* Show name: text-sm on /radio → text-base for ~15% bump on the YouTube render. */}
          <span className="text-base font-bold text-white uppercase tracking-wide">{data.showName}</span>
        </div>
        {/* Static hero overlay — replicates /radio's DJImageOverlay layout
            but with truncation rules instead of scrolling animations.
            Genres line moves below the DJ name when too long; bio is
            clamped to 5 lines with ellipsis; everything else is single-
            line truncate. */}
        <div
          className="absolute left-2 right-2 drop-shadow-lg"
          style={{ bottom: 65 + 8 }}
        >
          <RenderMixHeroOverlay
            djName={data.djName}
            djGenres={data.djGenres}
            djDescription={data.djDescription}
          />
        </div>

        {/* Player bar pinned to bottom of image. Static rules: show name +
            DJ name are single-line truncate (no scroll). */}
        <div className="absolute left-0 right-0 bottom-0 bg-black/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 py-2 px-1">
            <div className="flex items-center ml-1 flex-shrink-0">
              {data.sceneSlug && (
                <div className="w-8 h-8 flex items-center justify-center bg-white text-black flex-shrink-0">
                  <SceneGlyph slug={data.sceneSlug} className="!w-6 !h-6" />
                </div>
              )}
              {/* Pause button — mirrors /radio archive player exactly:
                  h-[27px] container with pl-2 pr-1 (asymmetric so the icon
                  sits visually centered between the scene block and the
                  show-name column), and a w-8 h-8 SVG that overflows the
                  container vertically (intentional — same on /radio). */}
              <div className="h-[27px] pl-2 pr-1 flex items-center justify-center flex-shrink-0">
                <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold leading-tight text-white truncate">{data.showName}</div>
              {data.djName && (
                <div className="text-[10px] text-zinc-500 mt-0.5 leading-[1.3em] truncate">
                  {data.djName}
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-between text-[10px] text-zinc-600 px-2 pb-0.5">
            <span>0:00</span>
            <span>{formatTime(data.durationSec)}</span>
          </div>
          <SelfDrivingProgressBar durationSec={data.durationSec} />
        </div>
      </div>

      {/* CHANNEL logo overlay — kept outside the scaled container so it
          stays visually fixed at its previous size regardless of SCALE. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-white.svg"
        alt="CHANNEL"
        className="absolute top-5 right-5 drop-shadow-lg"
        style={{ height: 60 }}
      />
    </div>
  );
}

/**
 * 1500×1500 square SoundCloud cover. SoundCloud requires square (1:1) art,
 * min 800×800, recommended 1500–2000px, JPG/PNG. We render at 1500×1500 —
 * worker screenshots → JPG q90 → uploaded to R2 alongside the YouTube mp4.
 *
 * Layout: photo fills the full square as a background; a bottom gradient
 * carries show name (large) + DJ name underneath, plus the CHANNEL logo
 * top-right. No player chrome, no progress bar — the cover is a still
 * frame, not a video thumbnail.
 */
function SquareCover({
  data,
}: {
  data: RenderData;
}) {
  const FRAME = 1500;
  return (
    <div className="bg-black relative overflow-hidden" style={{ width: FRAME, height: FRAME }}>
      <Image
        src={data.djPhotoUrl}
        alt={data.djName}
        fill
        className="object-cover"
        sizes={`${FRAME}px`}
        priority
        unoptimized
      />
      {/* Strong bottom gradient so the show + DJ name read against any photo. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/85" />
      {/* CHANNEL logo top-right, sized proportionally to the larger frame. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-white.svg"
        alt="CHANNEL"
        className="absolute top-10 right-10 drop-shadow-lg"
        style={{ height: 90 }}
      />
      <div className="absolute left-10 right-10 bottom-10 drop-shadow-lg">
        <div
          className="font-bold text-white uppercase tracking-wide leading-tight"
          style={{ fontSize: '64px' }}
        >
          {data.showName}
        </div>
        <div
          className="font-black uppercase tracking-wider text-white mt-3"
          style={{ fontSize: '40px' }}
        >
          {data.djName}
        </div>
        {data.djGenres.length > 0 && (
          <div
            className="font-medium uppercase tracking-[0.15em] text-zinc-300 mt-2 truncate"
            style={{ fontSize: '22px' }}
          >
            {data.djGenres.join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RenderMixPage() {
  return (
    <Suspense fallback={<div className="w-screen h-screen bg-black" />}>
      <RenderMixInner />
    </Suspense>
  );
}
