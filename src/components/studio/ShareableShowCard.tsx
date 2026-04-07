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

// 16:9 hero rectangle + thin URL strip flush below
const CANVAS_W = 1080;
const IMAGE_H = 608; // 1080 / 16 * 9 ≈ 608
const URL_STRIP_H = 56;
const CANVAS_H = IMAGE_H + URL_STRIP_H;

// Scale factor: hero uses Tailwind rem-based sizes at ~375px mobile width
// Canvas is 1080px wide, so scale ~2.88x from Tailwind px values
const S = CANVAS_W / 375;

function getOverlayInfo(startTime: number): { text: string; color: string } | null {
  const diff = startTime - Date.now();
  if (diff < 3600_000) {
    return { text: 'LIVE NOW', color: '#ef4444' };
  }
  if (diff < 6 * 86400_000) {
    const d = new Date(startTime);
    const day = d.toLocaleDateString('en-US', { weekday: 'long' });
    const hour = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return { text: `LIVE on ${day} ${hour}`, color: '#ffffff' };
  }
  return null;
}

function drawCoverImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement) {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const targetRatio = CANVAS_W / IMAGE_H;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (imgRatio > targetRatio) {
    sw = img.naturalHeight * targetRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / targetRatio;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, CANVAS_W, IMAGE_H);
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
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth) {
      let t = last;
      while (ctx.measureText(t + '...').width > maxWidth && t.length > 0) t = t.slice(0, -1);
      lines[maxLines - 1] = t + '...';
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

  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // DJ/show image (cover-cropped into 16:9)
  if (showImg) {
    drawCoverImage(ctx, showImg);
  } else {
    // No image fallback: dark bg with large DJ name centered (matches hero no-photo state)
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 0, CANVAS_W, IMAGE_H);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${Math.round(48 * S / 2)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((djName || showName).toUpperCase(), CANVAS_W / 2, IMAGE_H / 2);
    ctx.textAlign = 'left';
  }

  // Gradient scrims (matching hero: from-black/60 top, to-black/80 bottom)
  const topGrad = ctx.createLinearGradient(0, 0, 0, IMAGE_H);
  topGrad.addColorStop(0, 'rgba(0,0,0,0.6)');
  topGrad.addColorStop(0.4, 'rgba(0,0,0,0)');
  topGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, CANVAS_W, IMAGE_H);

  const botGrad = ctx.createLinearGradient(0, 0, 0, IMAGE_H);
  botGrad.addColorStop(0, 'rgba(0,0,0,0)');
  botGrad.addColorStop(0.5, 'rgba(0,0,0,0)');
  botGrad.addColorStop(1, 'rgba(0,0,0,0.8)');
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, 0, CANVAS_W, IMAGE_H);

  // Channel logo — top center
  if (logoImg) {
    const logoH = Math.round(28 * S / 2); // scale from hero's h-7 (28px)
    const logoW = logoImg.naturalWidth * (logoH / logoImg.naturalHeight);
    ctx.drawImage(logoImg, (CANVAS_W - logoW) / 2, Math.round(8 * S), logoW, logoH);
  }

  // Show name — top-2 left-2 = 8px * S
  // Hero: text-sm (14px) font-bold uppercase tracking-wide
  const pad = Math.round(8 * S); // matches top-2 left-2 (0.5rem = 8px)
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(14 * S)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.letterSpacing = '0.025em';
  ctx.fillText(showName.toUpperCase(), pad, pad);

  // DJ info overlay — bottom-2 left-2 right-2 (matching DJImageOverlay exactly)
  const overlayBottom = IMAGE_H - pad;
  let cursorY = overlayBottom;

  // Description: text-[11px] leading-[1.3em] text-zinc-300 font-light, max 2 lines
  if (description) {
    const descFontSize = Math.round(11 * S);
    const descLineH = Math.round(descFontSize * 1.3);
    ctx.font = `300 ${descFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = '#d4d4d8'; // zinc-300
    ctx.textBaseline = 'bottom';
    const descLines = wrapText(ctx, description, CANVAS_W - pad * 2, 2);
    // Draw from bottom up
    for (let i = descLines.length - 1; i >= 0; i--) {
      ctx.fillText(descLines[i], pad, cursorY);
      cursorY -= descLineH;
    }
    cursorY -= Math.round(4 * S); // mt-1 gap
  }

  // DJ Name + Genres: text-xs (12px) font-black uppercase tracking-wider
  // Genres: font-medium tracking-[0.15em] text-zinc-300
  const djFontSize = Math.round(12 * S);
  ctx.textBaseline = 'bottom';

  // Draw DJ name
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${djFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.letterSpacing = '0.05em';
  const djNameText = (djName || '').toUpperCase();
  ctx.fillText(djNameText, pad, cursorY);

  // Draw genres after DJ name
  if (genres && genres.length > 0) {
    const djNameWidth = ctx.measureText(djNameText).width;
    const genreStr = ' - ' + genres.join(' \u00B7 ');
    ctx.fillStyle = '#d4d4d8'; // zinc-300
    ctx.font = `500 ${djFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.letterSpacing = '0.15em';
    ctx.fillText(genreStr, pad + djNameWidth, cursorY, CANVAS_W - pad * 2 - djNameWidth);
  }
  ctx.letterSpacing = '0';

  // Bottom strip: overlay text (with red dot) + channel-app.com, flush below image
  const overlay = getOverlayInfo(startTime);
  const stripCenterY = IMAGE_H + URL_STRIP_H / 2;
  const fontSize = Math.round(12 * S);
  const dotRadius = Math.round(4 * S);

  if (overlay) {
    // Draw: red dot + overlay text on the left, channel-app.com on the right
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = 'middle';

    // Red dot
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(pad + dotRadius, stripCenterY, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    // Overlay text
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(overlay.text, pad + dotRadius * 2 + Math.round(6 * S), stripCenterY);

    // channel-app.com on the right
    ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText('channel-app.com', CANVAS_W - pad, stripCenterY);
  } else {
    // No overlay — just channel-app.com centered
    ctx.fillStyle = '#ffffff';
    ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('channel-app.com', CANVAS_W / 2, stripCenterY);
  }
  ctx.textAlign = 'left';
}

export function ShareableShowCard(props: ShareableShowCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;

    const loadImage = async (src: string): Promise<HTMLImageElement | null> => {
      try {
        // Fetch as blob to bypass CORS restrictions on Firebase Storage URLs
        const res = await fetch(src);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        return new Promise((resolve) => {
          const img = new window.Image();
          img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(img);
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(null);
          };
          img.src = objectUrl;
        });
      } catch {
        return null;
      }
    };

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

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
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
