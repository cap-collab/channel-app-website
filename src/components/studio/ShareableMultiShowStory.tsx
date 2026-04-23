'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

export interface MultiShowEntry {
  showName: string;
  djName: string;
  startTime: number;
  endTime: number;
  imageUrl?: string;
  genres?: string[];
}

interface ShareableMultiShowStoryProps {
  shows: MultiShowEntry[];
  dayLabel: string; // e.g., "Thursday"
}

// IG Story-safe: 1080×1620 (2:3) — fits story aspect without feeling overly long
const CANVAS_W = 1080;
const CANVAS_H = 1620;
const LOGO_STRIP_H = 96;
const INFO_STRIP_H = 104;
const PANEL_GAP = 8;

const S = CANVAS_W / 310;
const FONT = '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

function formatHour(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, '0')}${period}`;
}

function drawCoverLandscape(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const targetRatio = w / h;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (imgRatio > targetRatio) {
    sw = img.naturalHeight * targetRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / targetRatio;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawCanvas(
  ctx: CanvasRenderingContext2D,
  props: ShareableMultiShowStoryProps,
  showImgs: (HTMLImageElement | null)[],
  logoImg: HTMLImageElement | null,
  fontFamily: string,
) {
  const { shows, dayLabel } = props;
  const F = fontFamily;
  const pad = Math.round(10 * S);

  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // === Line 1: logo left + channel-app.com right ===
  const line1CenterY = LOGO_STRIP_H / 2;
  const fontSize = Math.round(11 * S);

  if (logoImg) {
    const logoH = 36; // match single-show card; independent of text scale
    const logoW = logoImg.naturalWidth * (logoH / logoImg.naturalHeight);
    ctx.drawImage(logoImg, pad, line1CenterY - logoH / 2, logoW, logoH);
  }

  ctx.fillStyle = '#a1a1aa';
  ctx.font = `500 ${fontSize}px ${F}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillText('channel-app.com', CANVAS_W - pad, line1CenterY);
  ctx.textAlign = 'left';

  // === Line 2: "LIVE [Day] [start] - [end]" centered with red dot ===
  if (shows.length > 0) {
    const firstStart = Math.min(...shows.map(s => s.startTime));
    const lastEnd = Math.max(...shows.map(s => s.endTime));
    const rangeText = `${dayLabel} ${formatHour(firstStart)} - ${formatHour(lastEnd)}`;

    const line2CenterY = LOGO_STRIP_H + INFO_STRIP_H / 2;
    const headerFontSize = Math.round(13 * S);
    const dotRadius = Math.round(4 * S);
    ctx.textBaseline = 'middle';

    const liveWord = 'LIVE';
    ctx.font = `700 ${headerFontSize}px ${F}`;
    const liveW = ctx.measureText(liveWord).width;
    ctx.font = `400 ${headerFontSize}px ${F}`;
    const restW = ctx.measureText(` ${rangeText}`).width;

    const dotSpace = dotRadius * 2 + Math.round(6 * S);
    const totalW = dotSpace + liveW + restW;
    const startX = (CANVAS_W - totalW) / 2;

    // Red dot
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(startX + dotRadius, line2CenterY, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    // LIVE in red bold
    ctx.fillStyle = '#ef4444';
    ctx.font = `700 ${headerFontSize}px ${F}`;
    ctx.textAlign = 'left';
    ctx.fillText(liveWord, startX + dotSpace, line2CenterY);

    // Range text in white
    ctx.fillStyle = '#ffffff';
    ctx.font = `400 ${headerFontSize}px ${F}`;
    ctx.fillText(` ${rangeText}`, startX + dotSpace + liveW, line2CenterY);
    ctx.textAlign = 'left';
  }

  // === Show panels (landscape strips) ===
  const panelsTop = LOGO_STRIP_H + INFO_STRIP_H;
  const panelsHeight = CANVAS_H - panelsTop;
  const totalGap = PANEL_GAP * Math.max(0, shows.length - 1);
  const panelH = Math.floor((panelsHeight - totalGap) / Math.max(1, shows.length));

  shows.forEach((show, i) => {
    const panelY = panelsTop + i * (panelH + PANEL_GAP);
    const img = showImgs[i];

    if (img) {
      drawCoverLandscape(ctx, img, 0, panelY, CANVAS_W, panelH);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, panelY, CANVAS_W, panelH);
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${Math.round(24 * S / 2)}px ${F}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((show.djName || show.showName).toUpperCase(), CANVAS_W / 2, panelY + panelH / 2);
      ctx.textAlign = 'left';
    }

    // Top scrim
    const topGrad = ctx.createLinearGradient(0, panelY, 0, panelY + panelH);
    topGrad.addColorStop(0, 'rgba(0,0,0,0.65)');
    topGrad.addColorStop(0.3, 'rgba(0,0,0,0)');
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, panelY, CANVAS_W, panelH);

    // Bottom scrim
    const botGrad = ctx.createLinearGradient(0, panelY, 0, panelY + panelH);
    botGrad.addColorStop(0, 'rgba(0,0,0,0)');
    botGrad.addColorStop(0.5, 'rgba(0,0,0,0)');
    botGrad.addColorStop(1, 'rgba(0,0,0,0.88)');
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, panelY, CANVAS_W, panelH);

    // Show name top-left + time top-right
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(13 * S)}px ${F}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.letterSpacing = '0.025em';
    ctx.fillText(show.showName.toUpperCase(), pad, panelY + pad);

    const timeStr = `${formatHour(show.startTime)} - ${formatHour(show.endTime)}`;
    ctx.font = `500 ${Math.round(11 * S)}px ${F}`;
    ctx.fillStyle = '#e4e4e7';
    ctx.textAlign = 'right';
    ctx.letterSpacing = '0.05em';
    ctx.fillText(timeStr, CANVAS_W - pad, panelY + pad + Math.round(2 * S));
    ctx.textAlign = 'left';

    // DJ name + genres at bottom
    const overlayBottom = panelY + panelH - pad;
    const djFontSize = Math.round(14 * S);
    ctx.textBaseline = 'bottom';

    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${djFontSize}px ${F}`;
    ctx.letterSpacing = '0.05em';
    const djNameText = (show.djName || '').toUpperCase();
    ctx.fillText(djNameText, pad, overlayBottom);

    if (show.genres && show.genres.length > 0) {
      const djNameWidth = ctx.measureText(djNameText).width;
      const genreStr = ' - ' + show.genres.map(g => g.toUpperCase()).join(' · ');
      ctx.fillStyle = '#d4d4d8';
      ctx.font = `500 ${djFontSize}px ${F}`;
      ctx.letterSpacing = '0.15em';
      const maxGenreW = CANVAS_W - pad * 2 - djNameWidth;
      if (maxGenreW > 0) {
        ctx.fillText(genreStr, pad + djNameWidth, overlayBottom, maxGenreW);
      }
    }
    ctx.letterSpacing = '0';
  });
}

export function ShareableMultiShowStory(props: ShareableMultiShowStoryProps) {
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
      const [showImgs, logoImg] = await Promise.all([
        Promise.all(props.shows.map(s => s.imageUrl ? loadImage(s.imageUrl) : Promise.resolve(null))),
        loadImage('/logo-white.png'),
      ]);
      if (cancelled) return;
      drawCanvas(ctx, props, showImgs, logoImg, computedFont);
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

      const fileName = `channel-${props.dayLabel.toLowerCase().replace(/\s+/g, '-')}-story.png`;
      const file = new File([blob], fileName, { type: 'image/png' });

      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      if (isMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        } catch {
          // Clipboard not supported
        }
        try {
          if ('showSaveFilePicker' in window) {
            const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
              suggestedName: fileName,
              types: [{ description: 'PNG Image', accept: { 'image/png': ['.png'] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
          } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
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
  }, [props.dayLabel]);

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
        {shared ? 'Copied & Saved!' : sharing ? 'Saving...' : 'Copy & Save Day Story'}
      </button>
    </div>
  );
}
