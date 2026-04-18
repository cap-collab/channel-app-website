'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { ArchiveSerialized } from '@/types/broadcast';
import { useDJProfileInfo } from '@/hooks/useDJProfileInfo';

// Square IG post: 1080×1080
const CANVAS_W = 1080;
const LOGO_STRIP_H = 83; // 30% thicker than original 64px
const IMAGE_H = CANVAS_W - LOGO_STRIP_H;
const CANVAS_H = CANVAS_W;

const S = CANVAS_W / 375;
const FONT = '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

function drawCoverImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, yOffset: number, h: number) {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const targetRatio = CANVAS_W / h;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (imgRatio > targetRatio) {
    sw = img.naturalHeight * targetRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / targetRatio;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, yOffset, CANVAS_W, h);
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
  archive: ArchiveSerialized,
  description: string | null,
  showImg: HTMLImageElement | null,
  fontFamily: string,
) {
  const F = fontFamily;
  const pad = Math.round(8 * S);

  const djNames = archive.djs?.map(d => d.name).join(', ') || 'Unknown';
  const primaryDj = archive.djs?.[0];
  const genres = primaryDj?.genres || [];

  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // === Hero image (top of canvas) ===
  const imgTop = 0;
  if (showImg) {
    drawCoverImage(ctx, showImg, imgTop, IMAGE_H);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, imgTop, CANVAS_W, IMAGE_H);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${Math.round(48 * S / 2)}px ${F}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((djNames || archive.showName).toUpperCase(), CANVAS_W / 2, imgTop + IMAGE_H / 2);
    ctx.textAlign = 'left';
  }

  // === Bottom strip: channel-app.com centered ===
  const logoStripTop = IMAGE_H;
  const line1CenterY = logoStripTop + LOGO_STRIP_H / 2;
  const fontSize = Math.round(11 * S);

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, logoStripTop, CANVAS_W, LOGO_STRIP_H);

  ctx.fillStyle = '#a1a1aa';
  ctx.font = `500 ${fontSize}px ${F}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillText('channel-app.com', CANVAS_W - pad, line1CenterY);
  ctx.textAlign = 'left';

  // Gradient scrims
  const topGrad = ctx.createLinearGradient(0, imgTop, 0, imgTop + IMAGE_H);
  topGrad.addColorStop(0, 'rgba(0,0,0,0.6)');
  topGrad.addColorStop(0.35, 'rgba(0,0,0,0)');
  topGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, imgTop, CANVAS_W, IMAGE_H);

  const botGrad = ctx.createLinearGradient(0, imgTop, 0, imgTop + IMAGE_H);
  botGrad.addColorStop(0, 'rgba(0,0,0,0)');
  botGrad.addColorStop(0.5, 'rgba(0,0,0,0)');
  botGrad.addColorStop(1, 'rgba(0,0,0,0.8)');
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, imgTop, CANVAS_W, IMAGE_H);

  // === Show name — top-left ===
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(14 * S)}px ${F}`;
  ctx.textBaseline = 'top';
  ctx.letterSpacing = '0.025em';
  ctx.fillText(archive.showName.toUpperCase(), pad, imgTop + pad);
  ctx.letterSpacing = '0';


  // === DJ info — bottom (build up from bottom) ===
  const overlayBottom = imgTop + IMAGE_H - pad;
  let cursorY = overlayBottom;
  const djFontSize = Math.round(12 * S);
  const hasDescription = !!description;

  // Empty line (preserving spacing where duration/date used to be)
  const durFontSize = Math.round(10 * S);
  cursorY -= Math.round(durFontSize * 1.3 + 4 * S);

  // Description (truncated, 2 lines max) — only if available
  if (hasDescription) {
    const descFontSize = Math.round(11 * S);
    const descLineH = Math.round(descFontSize * 1.3);
    ctx.font = `300 ${descFontSize}px ${F}`;
    ctx.fillStyle = '#d4d4d8';
    ctx.textBaseline = 'bottom';
    ctx.letterSpacing = '0';
    const descLines = wrapText(ctx, description!, CANVAS_W - pad * 2, 3);
    for (let i = descLines.length - 1; i >= 0; i--) {
      ctx.fillText(descLines[i], pad, cursorY);
      cursorY -= descLineH;
    }
    cursorY -= Math.round(4 * S);
  }

  if (hasDescription) {
    // With description: DJ NAME - GENRE · GENRE on one line, truncated
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${djFontSize}px ${F}`;
    ctx.letterSpacing = '0.05em';
    const djNameText = djNames.toUpperCase();

    if (genres.length > 0) {
      const djNameWidth = ctx.measureText(djNameText).width;
      ctx.fillText(djNameText, pad, cursorY);

      const genreStr = ' - ' + genres.map(g => g.toUpperCase()).join(' · ');
      ctx.fillStyle = '#d4d4d8';
      ctx.font = `500 ${djFontSize}px ${F}`;
      ctx.letterSpacing = '0.15em';
      ctx.fillText(genreStr, pad + djNameWidth, cursorY, CANVAS_W - pad * 2 - djNameWidth);
    } else {
      ctx.fillText(djNameText, pad, cursorY);
    }
  } else {
    // No description: DJ NAME on one line, genres on a separate line below
    // Genres first (they sit above the DJ name visually, since we build bottom-up)
    if (genres.length > 0) {
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#d4d4d8';
      ctx.font = `500 ${djFontSize}px ${F}`;
      ctx.letterSpacing = '0.15em';
      const genreStr = genres.map(g => g.toUpperCase()).join(' · ');
      ctx.fillText(genreStr, pad, cursorY, CANVAS_W - pad * 2);
      cursorY -= Math.round(djFontSize * 1.4);
    }

    // DJ name
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${djFontSize}px ${F}`;
    ctx.letterSpacing = '0.05em';
    ctx.fillText(djNames.toUpperCase(), pad, cursorY);
  }

  ctx.letterSpacing = '0';
}

export function ShareableArchiveCard({ archive }: { archive: ArchiveSerialized }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);

  const primaryDj = archive.djs?.[0];
  const djProfile = useDJProfileInfo(primaryDj?.username);
  const description = djProfile.bio;

  useEffect(() => {
    if (djProfile.loading) return;

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
        } catch { continue; }
      }
      return new Promise((resolve) => {
        const img = new window.Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });
    };

    const imageUrl = archive.showImageUrl || archive.djs?.[0]?.photoUrl;

    (async () => {
      const showImg = imageUrl ? await loadImage(imageUrl) : null;
      if (cancelled) return;
      drawCanvas(ctx, archive, description, showImg, computedFont);
      setReady(true);
    })();

    return () => { cancelled = true; };
  }, [archive, description, djProfile.loading]);

  const handleDownload = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setSharing(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      if (!blob) return;

      const slug = archive.slug || archive.showName.replace(/\s+/g, '-').toLowerCase();
      const file = new File([blob], `${slug}-social.png`, { type: 'image/png' });

      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      if (isMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ]);
        } catch { /* clipboard not supported */ }

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
  }, [archive.slug, archive.showName]);

  return (
    <>
      <div className="bg-black rounded-lg overflow-hidden border border-gray-800 relative" style={{ aspectRatio: '1/1' }}>
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
        onClick={handleDownload}
        disabled={!ready || sharing}
        className="mt-2 w-full flex items-center justify-center gap-2 bg-white text-black font-medium py-2.5 rounded transition-colors hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        {shared ? 'Copied & Saved!' : sharing ? 'Saving...' : 'Download Social'}
      </button>
    </>
  );
}
