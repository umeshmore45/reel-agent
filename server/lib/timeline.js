import { randomUUID } from 'node:crypto';

// Keep these lists in sync with web/lib/constants.ts.
export const FILTERS = ['none', 'vivid', 'warm', 'vintage', 'mono', 'cinematic', 'bright', 'moody', 'noir', 'pop'];
export const TRANSITIONS = ['cut', 'fade', 'fadeblack', 'slideleft', 'slideup', 'zoomin', 'circleopen'];
export const FONTS = ['montserrat', 'anton', 'bebas', 'poppins', 'playfair', 'marker'];
export const TEXT_STYLES = ['shadow', 'outline', 'box', 'glow'];
export const TEXT_ANIMS = ['none', 'pop', 'fade', 'slide', 'type'];
export const CAPTION_STYLES = ['pop', 'box', 'clean', 'neon', 'karaoke', 'minimal'];
export const FPS = 30;

export const DEFAULT_CAPTIONS = {
  enabled: true, style: 'pop', y: 0.68, size: 76, wordsPerPage: 3, uppercase: true, highlight: '', overrides: {},
};

export const DEFAULT_LOOK = { letterbox: 0, vignette: 0, fade: false };

export const emptyTimeline = () => ({ clips: [], texts: [], captions: { ...DEFAULT_CAPTIONS, overrides: {} }, music: null, look: { ...DEFAULT_LOOK } });

const num = (v, def, min, max) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};
const pick = (v, list, def) => (list.includes(v) ? v : def);
const color = (v, def) => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(v.trim()) ? v.trim() : def);
const r3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Cleans a timeline that came from the browser or the agent: drops clips whose media is missing,
 * clamps every number to a sane range, fills defaults, and gives everything a unique id.
 */
export function sanitizeTimeline(input, media, prev = emptyTimeline()) {
  const byId = new Map(media.map((m) => [m.id, m]));
  const ids = new Set();
  const uid = (id, prefix) => {
    const ok = typeof id === 'string' && /^[\w-]{1,40}$/.test(id) && !ids.has(id);
    const out = ok ? id : `${prefix}${randomUUID().slice(0, 8)}`;
    ids.add(out);
    return out;
  };
  const tl = input && typeof input === 'object' ? input : {};

  const clips = (Array.isArray(tl.clips) ? tl.clips : []).flatMap((c) => {
    const m = byId.get(c?.mediaId);
    if (!m || m.status !== 'ready' || (m.kind !== 'video' && m.kind !== 'image')) return [];
    const isImage = m.kind === 'image';
    const maxOut = isImage ? 60 : Math.max(0.1, m.duration);
    const inP = isImage ? 0 : num(c.in, 0, 0, Math.max(0, maxOut - 0.1));
    const out = num(c.out, isImage ? 3 : maxOut, inP + 0.1, maxOut);
    return [{
      id: uid(c.id, 'c'),
      mediaId: m.id,
      in: r3(inP),
      out: r3(out),
      speed: isImage ? 1 : num(c.speed, 1, 0.25, 4),
      volume: isImage ? 0 : num(c.volume, 1, 0, 1),
      fit: c.fit === 'blur' ? 'blur' : 'fill',
      focusX: num(c.focusX, 0.5, 0, 1),
      focusY: num(c.focusY, 0.5, 0, 1),
      zoom: pick(c.zoom, ['none', 'in', 'out', 'punch'], 'none'),
      zoomAmount: num(c.zoomAmount, 0.12, 0.02, 2.5),
      zoomX: num(c.zoomX, 0.5, 0, 1),
      zoomY: num(c.zoomY, 0.5, 0, 1),
      filter: pick(c.filter, FILTERS, 'none'),
      brightness: num(c.brightness, 0, -0.3, 0.3),
      contrast: num(c.contrast, 1, 0.5, 1.6),
      saturation: num(c.saturation, 1, 0, 2),
      transition: pick(c.transition, TRANSITIONS, 'cut'),
      transitionDuration: num(c.transitionDuration, 0.35, 0.1, 1.5),
    }];
  });

  const texts = (Array.isArray(tl.texts) ? tl.texts : []).flatMap((t) => {
    const text = typeof t?.text === 'string' ? t.text.slice(0, 300) : '';
    if (!text.trim()) return [];
    const start = num(t.start, 0, 0, 3600);
    return [{
      id: uid(t.id, 't'),
      text,
      start: r3(start),
      end: r3(num(t.end, start + 2, start + 0.2, 3600)),
      x: num(t.x, 0.5, 0, 1),
      y: num(t.y, 0.2, 0, 1),
      size: num(t.size, 80, 20, 240),
      font: pick(t.font, FONTS, 'montserrat'),
      color: color(t.color, '#ffffff'),
      bg: color(t.bg, '#7c3aed'),
      style: pick(t.style, TEXT_STYLES, 'shadow'),
      anim: pick(t.anim, TEXT_ANIMS, 'pop'),
    }];
  });

  const c = tl.captions && typeof tl.captions === 'object' ? tl.captions : {};
  const pc = prev.captions || DEFAULT_CAPTIONS;
  const overrides = c.overrides && typeof c.overrides === 'object' ? c.overrides : pc.overrides || {};
  const captions = {
    enabled: typeof c.enabled === 'boolean' ? c.enabled : pc.enabled,
    style: pick(c.style, CAPTION_STYLES, pc.style),
    y: num(c.y, pc.y, 0.05, 0.95),
    size: num(c.size, pc.size, 30, 160),
    wordsPerPage: Math.round(num(c.wordsPerPage, pc.wordsPerPage, 1, 8)),
    uppercase: typeof c.uppercase === 'boolean' ? c.uppercase : pc.uppercase,
    highlight: c.highlight === '' ? '' : color(c.highlight, pc.highlight),
    overrides: Object.fromEntries(Object.entries(overrides)
      .filter(([k, v]) => /^[\w-]+:\d+$/.test(k) && typeof v === 'string')
      .map(([k, v]) => [k, v.slice(0, 60)])),
  };

  let music = null;
  const mu = tl.music;
  const mm = mu && byId.get(mu.mediaId);
  if (mm && mm.status === 'ready' && mm.kind === 'audio') {
    music = {
      mediaId: mm.id,
      volume: num(mu.volume, 0.6, 0, 1),
      start: r3(num(mu.start, 0, 0, Math.max(0, mm.duration - 1))),
      fadeIn: num(mu.fadeIn, 0.5, 0, 5),
      fadeOut: num(mu.fadeOut, 1, 0, 5),
      duck: typeof mu.duck === 'boolean' ? mu.duck : true,
      duckLevel: num(mu.duckLevel, 0.3, 0.05, 1),
    };
  }

  const lk = tl.look && typeof tl.look === 'object' ? tl.look : {};
  const pl = prev.look || DEFAULT_LOOK;
  const look = {
    letterbox: num(lk.letterbox, pl.letterbox, 0, 0.2),
    vignette: num(lk.vignette, pl.vignette, 0, 1),
    fade: typeof lk.fade === 'boolean' ? lk.fade : pl.fade,
  };

  return { clips, texts, captions, music, look };
}

const frames = (sec) => Math.max(1, Math.round(sec * FPS));

/**
 * Reel positions in whole frames. A clip's transition overlaps the start of the next clip,
 * so the reel gets shorter by each transition's length. Same maths as web/lib/timeline.ts.
 */
export function layoutFrames(clips) {
  const durs = clips.map((c) => frames((c.out - c.in) / c.speed));
  const items = [];
  let start = 0;
  clips.forEach((c, i) => {
    const dur = durs[i];
    const next = durs[i + 1];
    const tOut = next && c.transition !== 'cut'
      ? Math.max(1, Math.min(frames(c.transitionDuration), Math.floor(Math.min(dur, next) * 0.45)))
      : 0;
    items.push({ clip: c, start, dur, tIn: i ? items[i - 1].tOut : 0, tOut });
    start += dur - tOut;
  });
  const total = items.length ? items[items.length - 1].start + items[items.length - 1].dur : 0;
  return { items, total };
}
