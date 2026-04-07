'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

interface ShareableShowCardProps {
  showName: string;
  djName: string;
  startTime: number;
  imageUrl?: string;
  genres?: string[];
  description?: string;
}

const CANVAS_W = 1080;
const CANVAS_H = 1350;
const PADDING = 60;
const IMAGE_BOTTOM = 810; // ~60% of height for the photo area

function getOverlayInfo(startTime: number): { text: string; color: string } | null {
  const diff = startTime - Date.now();
  if (diff < 3600_000) {
    return { text: 'LIVE NOW', color: '#ef4444' };
  }
  if (diff < 6 * 86400_000) {
    const d = new Date(startTime);
    const day = d.toLocaleDateString('en-US', { weekday: 'long' });
    const hour = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return { text: `LIVE ON ${day} ${hour}`, color: '#ffffff' };
  }
  return null;
}

function drawCoverImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement) {
  const targetW = CANVAS_W;
  const targetH = IMAGE_BOTTOM;
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const targetRatio = targetW / targetH;

  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (imgRatio > targetRatio) {
    sw = img.naturalHeight * targetRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / targetRatio;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      if (lines.length >= maxLines) break;
      current = word;
    } else {
      current = test;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  // Truncate last line if needed
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth) {
      let truncated = last;
      while (ctx.measureText(truncated + '...').width > maxWidth && truncated.length > 0) {
        truncated = truncated.slice(0, -1);
      }
      lines[maxLines - 1] = truncated + '...';
    }
  }
  return lines;
}

function drawCanvas(
  ctx: CanvasRenderingContext2D,
  props: ShareableShowCardProps,
  showImg: HTMLImageElement | null,
  logoImg: HTMLImageElement | null,
) {
  const { showName, djName, startTime, genres, description } = props;

  // 1. Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // 2. Show image (cover-cropped)
  if (showImg) {
    drawCoverImage(ctx, showImg);
  }

  // 3. Gradient scrims
  // Top scrim
  const topGrad = ctx.createLinearGradient(0, 0, 0, IMAGE_BOTTOM * 0.5);
  topGrad.addColorStop(0, 'rgba(0,0,0,0.7)');
  topGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, CANVAS_W, IMAGE_BOTTOM);

  // Bottom scrim
  const botGrad = ctx.createLinearGradient(0, IMAGE_BOTTOM * 0.5, 0, IMAGE_BOTTOM);
  botGrad.addColorStop(0, 'rgba(0,0,0,0)');
  botGrad.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, 0, CANVAS_W, IMAGE_BOTTOM);

  // 4. Channel logo (top center)
  if (logoImg) {
    const logoH = 40;
    const logoW = logoImg.naturalWidth * (logoH / logoImg.naturalHeight);
    ctx.drawImage(logoImg, (CANVAS_W - logoW) / 2, PADDING, logoW, logoH);
  }

  // 5. Show name (below logo, left-aligned)
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 52px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'top';
  const showNameLines = wrapText(ctx, showName.toUpperCase(), CANVAS_W - PADDING * 2, 3);
  let nameY = PADDING + 60;
  for (const line of showNameLines) {
    ctx.fillText(line, PADDING, nameY);
    nameY += 62;
  }

  // 6. Time overlay badge (top-right)
  const overlay = getOverlayInfo(startTime);
  if (overlay) {
    ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const textW = ctx.measureText(overlay.text).width;
    const badgeW = textW + 40;
    const badgeH = 52;
    const badgeX = CANVAS_W - PADDING - badgeW;
    const badgeY = PADDING;

    ctx.fillStyle = overlay.color;
    ctx.beginPath();
    const r = 8;
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, r);
    ctx.fill();

    ctx.fillStyle = overlay.color === '#ffffff' ? '#000000' : '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(overlay.text, badgeX + 20, badgeY + badgeH / 2);
  }

  // 7. DJ name + genres (bottom of image area)
  const genreText = genres && genres.length > 0 ? genres.join(' \u00B7 ') : null;
  const djLine = genreText ? `${djName.toUpperCase()} - ${genreText}` : djName.toUpperCase();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'bottom';
  const djY = IMAGE_BOTTOM - PADDING;
  ctx.fillText(djLine, PADDING, djY, CANVAS_W - PADDING * 2);

  // 8. Description (below image area)
  if (description) {
    ctx.fillStyle = '#d4d4d8'; // zinc-300
    ctx.font = '300 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'top';
    const descLines = wrapText(ctx, description, CANVAS_W - PADDING * 2, 4);
    let descY = IMAGE_BOTTOM + 40;
    for (const line of descLines) {
      ctx.fillText(line, PADDING, descY);
      descY += 38;
    }
  }

  // 9. "channel-app.com" at bottom
  ctx.fillStyle = '#ffffff';
  ctx.font = '500 34px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'center';
  ctx.fillText('channel-app.com', CANVAS_W / 2, CANVAS_H - PADDING);
  ctx.textAlign = 'left'; // reset
}

export function ShareableShowCard(props: ShareableShowCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);

  // Load images and draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;

    const loadImage = (src: string): Promise<HTMLImageElement | null> =>
      new Promise((resolve) => {
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });

    (async () => {
      const [showImg, logoImg] = await Promise.all([
        props.imageUrl ? loadImage(props.imageUrl) : Promise.resolve(null),
        loadImage('/logo-white.png'),
      ]);
      if (cancelled) return;
      drawCanvas(ctx, props, showImg, logoImg);
      setReady(true);
    })();

    return () => { cancelled = true; };
  }, [props]);

  const handleShare = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setSharing(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      if (!blob) return;

      const file = new File([blob], `${props.showName.replace(/\s+/g, '-').toLowerCase()}-channel.png`, {
        type: 'image/png',
      });

      // Try native share (mobile)
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        // Fallback: download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      }
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch (err) {
      // User cancelled share or error
      if ((err as DOMException)?.name !== 'AbortError') {
        console.error('Share failed:', err);
      }
    } finally {
      setSharing(false);
    }
  }, [props.showName]);

  return (
    <div className="mt-4">
      <p className="text-gray-500 text-xs mb-2">Share on your socials</p>
      <div className="bg-black rounded-lg overflow-hidden border border-gray-800">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="w-full h-auto"
          style={{ opacity: ready ? 1 : 0.3 }}
        />
      </div>
      <button
        onClick={handleShare}
        disabled={!ready || sharing}
        className="mt-2 w-full flex items-center justify-center gap-2 bg-white text-black font-medium py-2.5 rounded transition-colors hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        {shared ? 'Saved!' : sharing ? 'Saving...' : 'Save & Share Image'}
      </button>
    </div>
  );
}
