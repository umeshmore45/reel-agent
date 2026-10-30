import { CAPTION_STYLES, FILTER_CSS } from './constants';
import { FONTS } from './fonts';
import { clamp, type CaptionPage } from './timeline';
import type { Captions, Clip, Look, TextItem, Timeline, TransitionType } from './types';

type Ctx = CanvasRenderingContext2D;
export type Bounds = { id: string; x: number; y: number; w: number; h: number };

const easeOutBack = (p: number) => 1 + 2.4 * (p - 1) ** 3 + 1.4 * (p - 1) ** 2;
const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;
const q = (p: number) => Math.round(p * 1000) / 1000;

export function filterCss(c: Clip) {
  const parts = [FILTER_CSS[c.filter]];
  if (c.brightness) parts.push(`brightness(${(1 + c.brightness * 1.5).toFixed(3)})`);
  if (c.contrast !== 1) parts.push(`contrast(${c.contrast})`);
  if (c.saturation !== 1) parts.push(`saturate(${c.saturation})`);
  return parts.filter(Boolean).join(' ') || 'none';
}

/** One frame of a clip: fill-crop or fit-over-blur, zoom, colour. Mirrors the ffmpeg chain. */
export function drawClipFrame(ctx: Ctx, clip: Clip, src: CanvasImageSource, sw: number, sh: number, localT: number, dur: number, W: number, H: number) {
  if (!sw || !sh) return;
  ctx.save();
  if (clip.zoom !== 'none') {
    const p = clamp(localT / dur, 0, 1);
    const a = clip.zoomAmount;
    const z = clip.zoom === 'in' ? 1 + a * p
      : clip.zoom === 'out' ? 1 + a * (1 - p)
      : 1 + a * (1 - (1 - Math.min(1, localT / 0.5)) ** 3); // punch: eased over 0.5 s, then hold
    // Visible window centred on (zoomX, zoomY) but kept inside the frame, like ffmpeg's zoompan x/y.
    const x0 = clamp((clip.zoomX ?? 0.5) * W - W / z / 2, 0, W - W / z);
    const y0 = clamp((clip.zoomY ?? 0.5) * H - H / z / 2, 0, H - H / z);
    ctx.scale(z, z);
    ctx.translate(-x0, -y0);
  }
  const color = filterCss(clip);
  const cover = Math.max(W / sw, H / sh);
  if (clip.fit === 'blur') {
    const s = cover * 1.08;
    ctx.filter = `blur(${Math.round(W * 0.025)}px) brightness(0.88)${color === 'none' ? '' : ` ${color}`}`;
    ctx.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s);
    const fit = Math.min(W / sw, H / sh);
    ctx.filter = color;
    ctx.drawImage(src, (W - sw * fit) / 2, (H - sh * fit) / 2, sw * fit, sh * fit);
  } else {
    ctx.filter = color;
    const dw = sw * cover;
    const dh = sh * cover;
    ctx.drawImage(src, (W - dw) * clip.focusX, (H - dh) * clip.focusY, dw, dh);
  }
  ctx.restore();
}

/** Draws clip A turning into clip B at progress p (0..1). Matches ffmpeg's xfade transitions. */
export function drawTransition(ctx: Ctx, type: TransitionType, p: number, a: () => void, b: () => void, W: number, H: number) {
  ctx.save();
  switch (type) {
    case 'fade':
      a(); ctx.globalAlpha = p; b(); break;
    case 'fadeblack':
      if (p < 0.5) { ctx.globalAlpha = 1 - p * 2; a(); } else { ctx.globalAlpha = p * 2 - 1; b(); }
      break;
    case 'slideleft':
      ctx.translate(-p * W, 0); a(); ctx.translate(W, 0); b(); break;
    case 'slideup':
      ctx.translate(0, -p * H); a(); ctx.translate(0, H); b(); break;
    case 'zoomin':
      b(); ctx.globalAlpha = 1 - p; ctx.translate(W / 2, H / 2); ctx.scale(1 + p, 1 + p); ctx.translate(-W / 2, -H / 2); a(); break;
    case 'circleopen':
      a(); ctx.beginPath(); ctx.arc(W / 2, H / 2, (p * Math.hypot(W, H)) / 2, 0, Math.PI * 2); ctx.clip(); b(); break;
    default:
      b();
  }
  ctx.restore();
}

// ---------- overlays (captions + text) ----------

export const NO_LOOK: Look = { letterbox: 0, vignette: 0, fade: false };
export const FADE_IN = 0.5;
export const FADE_OUT = 0.7;

/** 1 at full picture, 0 at black, for the "fade" look. Also used for the preview's sound. */
export const fadeLevel = (look: Look, t: number, total: number) => (look.fade
  ? clamp(Math.min(t / FADE_IN, (total - t) / FADE_OUT), 0, 1)
  : 1);

export type OverlayOp =
  | { kind: 'look'; letterbox: number; vignette: number }
  | { kind: 'fade'; a: number }
  | { kind: 'caption'; page: CaptionPage; active: number; p: number }
  | { kind: 'text'; item: TextItem; p: number; outP: number; chars: number };

/**
 * What the overlay layer shows at time t. Its key changes only when the picture changes.
 * Order: look (vignette + bars) under the words, captions, text, then the fade to black on top.
 * `settleId` shows that text item without its in/out animation (the paused preview uses it for the selected item).
 */
export function overlayOps(tl: Timeline, pages: CaptionPage[], t: number, total: number, settleId?: string): OverlayOp[] {
  const ops: OverlayOp[] = [];
  const look = tl.look ?? NO_LOOK;
  if (look.letterbox > 0 || look.vignette > 0) ops.push({ kind: 'look', letterbox: look.letterbox, vignette: look.vignette });
  if (tl.captions.enabled) {
    const page = pages.find((pg) => t >= pg.start && t < pg.end);
    if (page) {
      let active = -1;
      page.words.forEach((w, i) => { if (t >= w.start) active = i; });
      ops.push({ kind: 'caption', page, active, p: q(clamp((t - page.start) / 0.14, 0, 1)) });
    }
  }
  for (const item of tl.texts) {
    if (t < item.start || t >= item.end) continue;
    const inDur = item.anim === 'type' ? Math.min(1.4, 0.05 * item.text.length) : 0.35;
    const still = item.anim === 'none' || item.id === settleId;
    const p = still ? 1 : q(clamp((t - item.start) / inDur, 0, 1));
    const outP = still ? 0 : q(clamp((t - (item.end - 0.2)) / 0.2, 0, 1));
    const chars = item.anim === 'type' ? Math.ceil(item.text.length * p) : item.text.length;
    ops.push({ kind: 'text', item, p, outP, chars });
  }
  const a = q(1 - fadeLevel(look, t, total));
  if (a > 0) ops.push({ kind: 'fade', a });
  return ops;
}

export const opsKey = (ops: OverlayOp[]) => ops.map((o) => {
  if (o.kind === 'look') return `L${o.letterbox}.${o.vignette}`;
  if (o.kind === 'fade') return `F${o.a}`;
  if (o.kind === 'caption') return `c${o.page.id}.${o.active}.${o.p}`;
  return `t${o.item.id}.${o.p}.${o.outP}.${o.chars}`;
}).join('|');

/** Draws captions then text items. S = canvas width / 1080. Returns hit boxes for the preview. */
export function drawOverlay(ctx: Ctx, ops: OverlayOp[], captions: Captions, W: number, H: number): Bounds[] {
  const S = W / 1080;
  const bounds: Bounds[] = [];
  for (const op of ops) {
    if (op.kind === 'look') drawLook(ctx, op, W, H);
    else if (op.kind === 'fade') {
      ctx.fillStyle = `rgba(0,0,0,${op.a})`;
      ctx.fillRect(0, 0, W, H);
    } else bounds.push(op.kind === 'caption' ? drawCaption(ctx, op, captions, S, W, H) : drawText(ctx, op, S, W, H));
  }
  return bounds;
}

function drawLook(ctx: Ctx, op: Extract<OverlayOp, { kind: 'look' }>, W: number, H: number) {
  ctx.save();
  if (op.vignette > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, H * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${(0.85 * op.vignette).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (op.letterbox > 0) {
    const bar = Math.round(op.letterbox * H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
  }
  ctx.restore();
}

function wrap(ctx: Ctx, words: string[], maxW: number, extraGap = 0) {
  const space = ctx.measureText(' ').width + extraGap;
  const lines: { idx: number[]; width: number }[] = [];
  let cur = { idx: [] as number[], width: 0 };
  words.forEach((w, i) => {
    const ww = ctx.measureText(w).width;
    const add = cur.idx.length ? space + ww : ww;
    if (cur.idx.length && cur.width + add > maxW) {
      lines.push(cur);
      cur = { idx: [i], width: ww };
    } else {
      cur.idx.push(i);
      cur.width += add;
    }
  });
  if (cur.idx.length) lines.push(cur);
  return { lines, space };
}

function drawCaption(ctx: Ctx, op: Extract<OverlayOp, { kind: 'caption' }>, cap: Captions, S: number, W: number, H: number): Bounds {
  const st = CAPTION_STYLES[cap.style];
  const size = cap.size * S;
  const highlight = cap.highlight || st.activeBg || st.active;
  ctx.save();
  ctx.font = `${st.weight} ${size}px ${FONTS[st.font].family}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const words = op.page.words.map((w) => (cap.uppercase ? w.text.toUpperCase() : w.text));
  // Outlines, scaled-up and boxed active words need more room than a plain space.
  const gap = size * ((st.strokeW || 0) + (st.activeScale ? 0.08 : 0) + (st.activeBg ? 0.22 : 0) + 0.04);
  const { lines, space } = wrap(ctx, words, W * 0.84, gap);
  const lineH = size * 1.22;
  const cy = cap.y * H;
  const top = cy - (lines.length * lineH) / 2;
  const maxW = Math.max(...lines.map((l) => l.width));

  const e = easeOutBack(op.p);
  ctx.globalAlpha = Math.min(1, op.p * 1.8);
  ctx.translate(W / 2, cy);
  ctx.scale(0.82 + 0.18 * e, 0.82 + 0.18 * e);
  ctx.translate(-W / 2, -cy);

  if (st.bar) {
    ctx.fillStyle = st.bar;
    ctx.beginPath();
    ctx.roundRect(W / 2 - maxW / 2 - size * 0.4, top - size * 0.15, maxW + size * 0.8, lines.length * lineH + size * 0.3, size * 0.3);
    ctx.fill();
  }

  lines.forEach((line, li) => {
    let x = W / 2 - line.width / 2;
    const y = top + li * lineH + lineH / 2;
    for (const i of line.idx) {
      const w = words[i];
      const ww = ctx.measureText(w).width;
      const isActive = i === op.active;
      let fill = st.color;
      if (st.spoken && i < op.active) fill = st.spoken;
      if (isActive) fill = st.activeBg ? st.active : cap.highlight || st.active;
      ctx.save();
      if (isActive && st.activeScale) {
        ctx.translate(x + ww / 2, y);
        ctx.scale(st.activeScale, st.activeScale);
        ctx.translate(-(x + ww / 2), -y);
      }
      if (isActive && st.activeBg) {
        ctx.fillStyle = highlight;
        ctx.beginPath();
        ctx.roundRect(x - size * 0.16, y - size * 0.58, ww + size * 0.32, size * 1.12, size * 0.2);
        ctx.fill();
      }
      if (st.stroke) {
        ctx.strokeStyle = st.stroke;
        ctx.lineWidth = size * (st.strokeW || 0.1) * 2;
        ctx.strokeText(w, x, y);
      }
      if (st.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = size * 0.25;
        ctx.shadowOffsetY = size * 0.05;
      }
      if (st.glow) {
        ctx.shadowColor = isActive ? fill : st.glow;
        ctx.shadowBlur = size * 0.5;
        ctx.fillStyle = fill;
        ctx.fillText(w, x, y);
      }
      ctx.fillStyle = fill;
      ctx.fillText(w, x, y);
      ctx.restore();
      x += ww + space;
    }
  });
  ctx.restore();
  return { id: 'captions', x: W / 2 - maxW / 2 - size * 0.3, y: top, w: maxW + size * 0.6, h: lines.length * lineH };
}

function drawText(ctx: Ctx, op: Extract<OverlayOp, { kind: 'text' }>, S: number, W: number, H: number): Bounds {
  const it = op.item;
  const f = FONTS[it.font] || FONTS.montserrat;
  const size = it.size * S;
  ctx.save();
  ctx.font = `${f.weight} ${size}px ${f.family}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const padX = it.style === 'box' ? size * 0.35 : 0;
  const rawLines = it.text.split('\n');
  const lines: string[] = [];
  for (const raw of rawLines) {
    const words = raw.split(/\s+/).filter(Boolean);
    const { lines: wrapped } = wrap(ctx, words, W * 0.86 - padX * 2);
    if (!wrapped.length) lines.push('');
    wrapped.forEach((l) => lines.push(l.idx.map((i) => words[i]).join(' ')));
  }
  const lineH = size * (it.style === 'box' ? 1.32 : 1.18);
  const cx = it.x * W;
  const cy = it.y * H;
  const top = cy - (lines.length * lineH) / 2;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const maxW = Math.max(...widths, 1);

  let scale = 1;
  let alpha = 1;
  let dy = 0;
  if (it.anim === 'pop') { scale = 0.5 + 0.5 * easeOutBack(op.p); alpha = Math.min(1, op.p * 2); }
  if (it.anim === 'fade') alpha = op.p;
  if (it.anim === 'slide') { dy = (1 - easeOutCubic(op.p)) * 90 * S; alpha = op.p; }
  alpha *= 1 - op.outP;
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.translate(cx, cy + dy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  let budget = op.chars;
  lines.forEach((line, i) => {
    if (budget <= 0) return;
    const shown = line.slice(0, budget);
    budget -= line.length + 1;
    const x = cx - widths[i] / 2;
    const y = top + i * lineH + lineH / 2;
    if (it.style === 'box') {
      ctx.fillStyle = it.bg;
      ctx.beginPath();
      ctx.roundRect(x - padX, y - lineH / 2 + size * 0.04, ctx.measureText(shown).width + padX * 2, lineH - size * 0.08, size * 0.22);
      ctx.fill();
    }
    if (it.style === 'outline') {
      ctx.strokeStyle = it.bg;
      ctx.lineWidth = size * 0.16;
      ctx.strokeText(shown, x, y);
    }
    if (it.style === 'shadow') {
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = size * 0.3;
      ctx.shadowOffsetY = size * 0.05;
    }
    if (it.style === 'glow') {
      ctx.shadowColor = it.bg;
      ctx.shadowBlur = size * 0.6;
      ctx.fillStyle = it.color;
      ctx.fillText(shown, x, y);
    }
    ctx.fillStyle = it.color;
    ctx.fillText(shown, x, y);
    ctx.shadowColor = 'transparent';
  });
  ctx.restore();
  return { id: it.id, x: cx - maxW / 2 - padX, y: top, w: maxW + padX * 2, h: lines.length * lineH };
}
