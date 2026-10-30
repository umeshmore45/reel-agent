import { startRender } from './api';
import { FPS } from './constants';
import { drawOverlay, opsKey, overlayOps } from './draw';
import { loadFonts } from './fonts';
import { captionPages, layoutClips, reelWords, speechRegions } from './timeline';
import type { Media, Timeline } from './types';

export type ExportPhase = { phase: 'overlays' | 'upload'; progress: number };

// WebP, not PNG: Chrome encodes a 1080x1920 PNG in 1-5 s but a WebP in ~60 ms. Alpha stays lossless,
// and the colour loss at this quality is below what the 4:2:0 H.264 output keeps anyway.
const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) =>
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw overlay'))), 'image/webp', 0.97));

/**
 * Draws the caption/text layer with the preview's own canvas code, one transparent image per
 * distinct look (consecutive frames that look the same share one image), then uploads them with
 * the timeline. The server composites them over the video with ffmpeg.
 */
export async function exportReel(projectId: string, tl: Timeline, media: Media[], opts: { height: 1920 | 1280; fast: boolean; music: boolean }, onPhase: (p: ExportPhase) => void) {
  const W = opts.height === 1280 ? 720 : 1080;
  const H = opts.height;
  const mediaMap = new Map(media.map((m) => [m.id, m]));
  const layout = layoutClips(tl.clips.filter((c) => mediaMap.get(c.mediaId)?.status === 'ready'));
  const words = reelWords(tl, layout, mediaMap);
  const pages = captionPages(words, tl.captions.wordsPerPage);
  const totalFrames = Math.round(layout.total * FPS);

  const segments: { key: string; frames: number; t: number }[] = [];
  for (let f = 0; f < totalFrames; f++) {
    const t = (f + 0.5) / FPS;
    const key = opsKey(overlayOps(tl, pages, t, layout.total));
    const last = segments[segments.length - 1];
    if (last && last.key === key) last.frames++;
    else segments.push({ key, frames: 1, t });
  }

  await loadFonts();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const form = new FormData();
  const overlays: { file: string; duration: number }[] = [];
  const hasOverlay = segments.some((s) => s.key);

  if (hasOverlay) {
    form.append('overlays', await toBlob(canvas), 'blank.webp');
    let n = 0;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      let file = 'blank.webp';
      if (s.key) {
        ctx.clearRect(0, 0, W, H);
        drawOverlay(ctx, overlayOps(tl, pages, s.t, layout.total), tl.captions, W, H);
        file = `ov_${String(n++).padStart(5, '0')}.webp`;
        form.append('overlays', await toBlob(canvas), file);
      }
      overlays.push({ file, duration: s.frames / FPS });
      if (i % 4 === 0) onPhase({ phase: 'overlays', progress: i / segments.length });
    }
  }

  form.append('meta', JSON.stringify({
    timeline: opts.music ? tl : { ...tl, music: null }, height: opts.height, fast: opts.fast, overlays, duckRegions: speechRegions(words),
  }));
  onPhase({ phase: 'upload', progress: 0 });
  return startRender(projectId, form, (p) => onPhase({ phase: 'upload', progress: p }));
}
