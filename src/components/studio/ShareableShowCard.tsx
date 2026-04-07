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

// Layout: logo (top) + info strip (LIVE on... | channel-app.com) + 16:9 hero image
const CANVAS_W = 1080;
const LOGO_STRIP_H = 64;
const INFO_STRIP_H = 72;
const IMAGE_H = 608; // 16:9
const CANVAS_H = LOGO_STRIP_H + INFO_STRIP_H + IMAGE_H;

// Scale factor from Tailwind's 375px base to 1080px canvas
const S = CANVAS_W / 375;

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
  props: ShareableShowCardProps,
  showImg: HTMLImageElement | null,
  logoImg: HTMLImageElement | null,
  fontFamily: string,
) {
  const { showName, djName, startTime, genres, description } = props;
  const F = fontFamily;
  const pad = Math.round(8 * S);

  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // === Line 1: logo left + channel-app.com right ===
  const line1CenterY = LOGO_STRIP_H / 2;
  const fontSize = Math.round(11 * S);

  if (logoImg) {
    const logoH = Math.round(24 * S / 2);
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

    // Split into "LIVE" (red, bold) + rest (white, normal weight)
    // For "LIVE NOW": liveWord = "LIVE NOW" all red
    // For "LIVE on ...": liveWord = "LIVE" red, rest = " on Tuesday 2 PM" white
    const isLiveNow = overlay.text === 'LIVE NOW';
    const liveWord = isLiveNow ? 'LIVE NOW' : 'LIVE';
    const restText = isLiveNow ? '' : overlay.text.slice(4); // " on Tuesday 2 PM"

    // Measure both parts to center everything
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

  // === 16:9 hero image ===
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

  // Gradient scrims (matching hero: from-black/60 top, to-black/80 bottom)
  const topGrad = ctx.createLinearGradient(0, imgTop, 0, imgTop + IMAGE_H);
  topGrad.addColorStop(0, 'rgba(0,0,0,0.6)');
  topGrad.addColorStop(0.4, 'rgba(0,0,0,0)');
  topGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, imgTop, CANVAS_W, IMAGE_H);

  const botGrad = ctx.createLinearGradient(0, imgTop, 0, imgTop + IMAGE_H);
  botGrad.addColorStop(0, 'rgba(0,0,0,0)');
  botGrad.addColorStop(0.5, 'rgba(0,0,0,0)');
  botGrad.addColorStop(1, 'rgba(0,0,0,0.8)');
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, imgTop, CANVAS_W, IMAGE_H);

  // === Text overlays on image (matching hero exactly) ===

  // Show name — top-left of image
  // Hero: text-sm (14px) font-bold uppercase tracking-wide
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(14 * S)}px ${F}`;
  ctx.textBaseline = 'top';
  ctx.letterSpacing = '0.025em';
  ctx.fillText(showName.toUpperCase(), pad, imgTop + pad);

  // DJ info overlay — bottom of image (matching DJImageOverlay)
  const overlayBottom = imgTop + IMAGE_H - pad;
  let cursorY = overlayBottom;

  // Description: text-[11px] leading-[1.3em] text-zinc-300 font-light, max 2 lines
  if (description) {
    const descFontSize = Math.round(11 * S);
    const descLineH = Math.round(descFontSize * 1.3);
    ctx.font = `300 ${descFontSize}px ${F}`;
    ctx.fillStyle = '#d4d4d8';
    ctx.textBaseline = 'bottom';
    ctx.letterSpacing = '0';
    const descLines = wrapText(ctx, description, CANVAS_W - pad * 2, 2);
    for (let i = descLines.length - 1; i >= 0; i--) {
      ctx.fillText(descLines[i], pad, cursorY);
      cursorY -= descLineH;
    }
    cursorY -= Math.round(4 * S);
  }

  // DJ Name + Genres: text-xs (12px) font-black uppercase tracking-wider
  const djFontSize = Math.round(12 * S);
  ctx.textBaseline = 'bottom';

  // DJ name — font-black (900) uppercase
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${djFontSize}px ${F}`;
  ctx.letterSpacing = '0.05em';
  const djNameText = (djName || '').toUpperCase();
  ctx.fillText(djNameText, pad, cursorY);

  // Genres — font-medium (500) tracking-[0.15em] text-zinc-300, UPPERCASE
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

    // Read the actual font-family from the page (Geist Sans loaded via Next.js)
    const computedFont = getComputedStyle(document.body).fontFamily || FONT;

    const loadImage = async (src: string): Promise<HTMLImageElement | null> => {
      // Try multiple strategies to load the image for canvas use:
      // 1. Fetch as blob (bypasses CORS, works for most URLs)
      // 2. Next.js image proxy (handles Firebase Storage CORS)
      // 3. Direct load without crossOrigin (last resort, may taint canvas)
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

      // Final fallback: load directly (may not be exportable but at least shows)
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

      const file = new File([blob], `${props.showName.replace(/\s+/g, '-').toLowerCase()}-channel.png`, {
        type: 'image/png',
      });

      // Detect mobile (touch device without mouse) vs desktop
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      if (isMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
        // Mobile: native share sheet with image file
        await navigator.share({ files: [file] });
      } else {
        // Desktop: copy to clipboard + Save As dialog
        // 1. Copy image to clipboard
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ]);
        } catch {
          // Clipboard not supported, continue to save
        }

        // 2. Save file — use File System Access API (Save As dialog) or fallback to download
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
          // User cancelled save dialog — that's fine, image is still copied
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
    <div className="mt-4">
      <p className="text-gray-500 text-xs mb-2">Share on your socials</p>
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
        {shared ? 'Copied & Saved!' : sharing ? 'Saving...' : 'Copy & Save Image'}
      </button>
    </div>
  );
}
