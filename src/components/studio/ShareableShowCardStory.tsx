'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

interface ShareableShowCardStoryProps {
  showName: string;
  djName: string;
  startTime: number;
  imageUrl?: string;
  genres?: string[];
  description?: string;
}

// IG Story: 1080×1080 square — image keeps its proportions
const CANVAS_W = 1080;
const LOGO_STRIP_H = 96;
const INFO_STRIP_H = 104;
const IMAGE_H = 920; // slightly smaller to make room for bigger strips
const CANVAS_H = LOGO_STRIP_H + INFO_STRIP_H + IMAGE_H;

// Scale factor — bumped up for larger text
const S = CANVAS_W / 310;

// Font stack: Geist Sans (loaded on page) with system fallbacks
const FONT = '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

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

function drawCoverImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, yOffset: number) {
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
  ctx.drawImage(img, sx, sy, sw, sh, 0, yOffset, CANVAS_W, IMAGE_H);
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
  props: ShareableShowCardStoryProps,
  showImg: HTMLImageElement | null,
  logoImg: HTMLImageElement | null,
  fontFamily: string,
) {
  const { showName, djName, startTime, genres, description } = props;
  const F = fontFamily;
  const pad = Math.round(10 * S);

  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // === Line 1: logo left + channel-app.com right ===
  const line1CenterY = LOGO_STRIP_H / 2;
  const fontSize = Math.round(11 * S);

  if (logoImg) {
    const logoH = 36; // fixed height, independent of text scale
    const logoW = logoImg.naturalWidth * (logoH / logoImg.naturalHeight);
    ctx.drawImage(logoImg, pad, line1CenterY - logoH / 2, logoW, logoH);
  }

  ctx.fillStyle = '#a1a1aa'; // zinc-400
  ctx.font = `500 ${fontSize}px ${F}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillText('channel-app.com', CANVAS_W - pad, line1CenterY);
  ctx.textAlign = 'left';

  // === Line 2: "LIVE on..." centered with red dot ===
  const overlay = getOverlayInfo(startTime);
  const dotRadius = Math.round(3.5 * S);

  if (overlay) {
    const line2CenterY = LOGO_STRIP_H + INFO_STRIP_H / 2;
    ctx.textBaseline = 'middle';

    const isLiveNow = overlay.text === 'LIVE NOW';
    const liveWord = isLiveNow ? 'LIVE NOW' : 'LIVE';
    const restText = isLiveNow ? '' : overlay.text.slice(4);

    ctx.font = `700 ${fontSize}px ${F}`;
    const liveW = ctx.measureText(liveWord).width;
    ctx.font = `400 ${fontSize}px ${F}`;
    const restW = restText ? ctx.measureText(restText).width : 0;

    const dotSpace = dotRadius * 2 + Math.round(5 * S);
    const totalW = dotSpace + liveW + restW;
    const startX = (CANVAS_W - totalW) / 2;

    // Red dot
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(startX + dotRadius, line2CenterY, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    // "LIVE" or "LIVE NOW" in red, bold
    ctx.fillStyle = '#ef4444';
    ctx.font = `700 ${fontSize}px ${F}`;
    ctx.textAlign = 'left';
    ctx.fillText(liveWord, startX + dotSpace, line2CenterY);

    // Rest of text in white, normal weight
    if (restText) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `400 ${fontSize}px ${F}`;
      ctx.fillText(restText, startX + dotSpace + liveW, line2CenterY);
    }
    ctx.textAlign = 'left';
  }

  // === Full-height hero image ===
  const imgTop = LOGO_STRIP_H + INFO_STRIP_H;
  if (showImg) {
    drawCoverImage(ctx, showImg, imgTop);
  } else {
    // No image fallback
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, imgTop, CANVAS_W, IMAGE_H);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${Math.round(48 * S / 2)}px ${F}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((djName || showName).toUpperCase(), CANVAS_W / 2, imgTop + IMAGE_H / 2);
    ctx.textAlign = 'left';
  }

  // Gradient scrims
  const topGrad = ctx.createLinearGradient(0, imgTop, 0, imgTop + IMAGE_H);
  topGrad.addColorStop(0, 'rgba(0,0,0,0.6)');
  topGrad.addColorStop(0.25, 'rgba(0,0,0,0)');
  topGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, imgTop, CANVAS_W, IMAGE_H);

  const botGrad = ctx.createLinearGradient(0, imgTop, 0, imgTop + IMAGE_H);
  botGrad.addColorStop(0, 'rgba(0,0,0,0)');
  botGrad.addColorStop(0.55, 'rgba(0,0,0,0)');
  botGrad.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, imgTop, CANVAS_W, IMAGE_H);

  // === Text overlays on image ===

  // Show name — top-left of image
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(14 * S)}px ${F}`;
  ctx.textBaseline = 'top';
  ctx.letterSpacing = '0.025em';
  ctx.fillText(showName.toUpperCase(), pad, imgTop + pad);

  // DJ info overlay — bottom of image
  const overlayBottom = imgTop + IMAGE_H - pad;
  let cursorY = overlayBottom;

  // Description: max 3 lines (more room in vertical format)
  if (description) {
    const descFontSize = Math.round(11 * S);
    const descLineH = Math.round(descFontSize * 1.3);
    ctx.font = `300 ${descFontSize}px ${F}`;
    ctx.fillStyle = '#d4d4d8';
    ctx.textBaseline = 'bottom';
    ctx.letterSpacing = '0';
    const descLines = wrapText(ctx, description, CANVAS_W - pad * 2, 3);
    for (let i = descLines.length - 1; i >= 0; i--) {
      ctx.fillText(descLines[i], pad, cursorY);
      cursorY -= descLineH;
    }
    cursorY -= Math.round(4 * S);
  }

  // DJ Name + Genres
  const djFontSize = Math.round(12 * S);
  ctx.textBaseline = 'bottom';

  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${djFontSize}px ${F}`;
  ctx.letterSpacing = '0.05em';
  const djNameText = (djName || '').toUpperCase();
  ctx.fillText(djNameText, pad, cursorY);

  if (genres && genres.length > 0) {
    const djNameWidth = ctx.measureText(djNameText).width;
    const genreStr = ' - ' + genres.map(g => g.toUpperCase()).join(' \u00B7 ');
    ctx.fillStyle = '#d4d4d8';
    ctx.font = `500 ${djFontSize}px ${F}`;
    ctx.letterSpacing = '0.15em';
    ctx.fillText(genreStr, pad + djNameWidth, cursorY, CANVAS_W - pad * 2 - djNameWidth);
  }
  ctx.letterSpacing = '0';
}

export function ShareableShowCardStory(props: ShareableShowCardStoryProps) {
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

    const computedFont = getComputedStyle(document.body).fontFamily || FONT;

    const loadImage = async (src: string): Promise<HTMLImageElement | null> => {
      const strategies = [
        () => fetch(src).then(r => r.blob()).then(b => URL.createObjectURL(b)),
        () => fetch(`/_next/image?url=${encodeURIComponent(src)}&w=1080&q=90`).then(r => r.blob()).then(b => URL.createObjectURL(b)),
      ];

      for (const strategy of strategies) {
        try {
          const objectUrl = await strategy();
          const result = await new Promise<HTMLImageElement | null>((resolve) => {
            const img = new window.Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = objectUrl;
          });
          if (result) return result;
        } catch {
          continue;
        }
      }

      return new Promise((resolve) => {
        const img = new window.Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });
    };

    (async () => {
      const [showImg, logoImg] = await Promise.all([
        props.imageUrl ? loadImage(props.imageUrl) : Promise.resolve(null),
        loadImage('/logo-white.png'),
      ]);
      if (cancelled) return;
      drawCanvas(ctx, props, showImg, logoImg, computedFont);
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

      const file = new File([blob], `${props.showName.replace(/\s+/g, '-').toLowerCase()}-channel-story.png`, {
        type: 'image/png',
      });

      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      if (isMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ]);
        } catch {
          // Clipboard not supported, continue to save
        }

        try {
          if ('showSaveFilePicker' in window) {
            const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
              suggestedName: file.name,
              types: [{ description: 'PNG Image', accept: { 'image/png': ['.png'] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
          } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            a.click();
            URL.revokeObjectURL(url);
          }
        } catch (saveErr) {
          if ((saveErr as DOMException)?.name !== 'AbortError') {
            console.error('Save failed:', saveErr);
          }
        }
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
    <div>
      <div className="bg-black rounded-lg overflow-hidden border border-gray-800 relative" style={{ aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}>
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="w-full h-auto"
          style={{ opacity: ready ? 1 : 0 }}
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
        {shared ? 'Copied & Saved!' : sharing ? 'Saving...' : 'Copy & Save Story'}
      </button>
    </div>
  );
}
