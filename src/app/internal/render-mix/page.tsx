'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { DJImageOverlay, ScrollingShowName, ScrollingDJName } from '@/components/channel/LiveBroadcastHero';
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

function RenderMixInner() {
  const searchParams = useSearchParams();
  const data = useMemo(() => parseRenderData(searchParams.get('data')), [searchParams]);

  if (!data) {
    // No params = not a real render request. Stay blank — this URL is not
    // user-facing and shouldn't render anything discoverable.
    return <div className="w-screen h-screen bg-black" />;
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
          <span className="text-sm font-bold text-white uppercase tracking-wide">{data.showName}</span>
        </div>
        {/* DJImageOverlay positions itself with `absolute bottom-2 left-2
            right-2` relative to its nearest positioned ancestor. We give it a
            wrapper that ends just above the player bar so its bottom-2 anchor
            lands above the player instead of getting covered by it. Player
            bar in reference space ≈ 65px tall (play row 32px + time labels
            14px + progress 3px + py-2 padding 16px). */}
        <div className="absolute inset-0" style={{ bottom: 65 }}>
          <DJImageOverlay djName={data.djName} djGenres={data.djGenres} djDescription={data.djDescription} />
        </div>

        {/* Player bar pinned to bottom of image — same markup as before, just
            absolute-positioned over the photo instead of below it. */}
        <div className="absolute left-0 right-0 bottom-0 bg-black/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 py-2 px-1">
            <div className="flex items-center ml-1 flex-shrink-0">
              {data.sceneSlug && (
                <div className="w-8 h-8 flex items-center justify-center bg-white text-black flex-shrink-0">
                  <SceneGlyph slug={data.sceneSlug} className="!w-6 !h-6" />
                </div>
              )}
              <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <ScrollingShowName text={data.showName} className="text-sm font-bold leading-tight text-white" />
              {data.djName && (
                <ScrollingDJName
                  text={data.djName}
                  className="text-[10px] text-zinc-500 uppercase mt-0.5 leading-[1.3em]"
                />
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

export default function RenderMixPage() {
  return (
    <Suspense fallback={<div className="w-screen h-screen bg-black" />}>
      <RenderMixInner />
    </Suspense>
  );
}
