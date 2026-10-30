import { FILLERS, FPS } from './constants';
import type { Clip, Media, TextItem, Timeline } from './types';

export const uid = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 10)}`;
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const frames = (sec: number) => Math.max(1, Math.round(sec * FPS));

export type ClipLayout = { clip: Clip; index: number; start: number; end: number; dur: number; tIn: number; tOut: number };
export type Layout = { items: ClipLayout[]; total: number };

/**
 * Reel positions in seconds, snapped to whole frames. A clip's transition overlaps the start of
 * the next clip. Same maths as layoutFrames() in server/lib/timeline.js so preview == export.
 */
export function layoutClips(clips: Clip[]): Layout {
  const durs = clips.map((c) => frames((c.out - c.in) / c.speed));
  const items: ClipLayout[] = [];
  let start = 0;
  clips.forEach((clip, i) => {
    const dur = durs[i];
    const next = durs[i + 1];
    const tOut = next && clip.transition !== 'cut'
      ? Math.max(1, Math.min(frames(clip.transitionDuration), Math.floor(Math.min(dur, next) * 0.45)))
      : 0;
    const tIn = i ? Math.round(items[i - 1].tOut * FPS) : 0;
    items.push({ clip, index: i, start: start / FPS, end: (start + dur) / FPS, dur: dur / FPS, tIn: tIn / FPS, tOut: tOut / FPS });
    start += dur - tOut;
  });
  return { items, total: items.length ? items[items.length - 1].end : 0 };
}

/** Clips visible at time t (two during a transition), in track order. */
export function activeClips(layout: Layout, t: number) {
  return layout.items.filter((li) => t >= li.start && t < li.end);
}

export function newClip(m: Media): Clip {
  return {
    id: uid('c'),
    mediaId: m.id,
    in: 0,
    out: m.kind === 'image' ? 3 : m.duration,
    speed: 1,
    volume: m.kind === 'image' ? 0 : 1,
    fit: m.width > m.height * 1.2 && m.kind === 'image' ? 'blur' : 'fill',
    focusX: 0.5,
    focusY: 0.5,
    zoom: m.kind === 'image' ? 'in' : 'none',
    zoomAmount: 0.12,
    filter: 'none',
    brightness: 0,
    contrast: 1,
    saturation: 1,
    transition: 'cut',
    transitionDuration: 0.35,
  };
}

export function newText(t: number, patch: Partial<TextItem> = {}): TextItem {
  return {
    id: uid('t'), text: 'Your text', start: t, end: t + 2.5, x: 0.5, y: 0.22, size: 84,
    font: 'montserrat', color: '#ffffff', bg: '#7c3aed', style: 'shadow', anim: 'pop', ...patch,
  };
}

export const updateClip = (tl: Timeline, id: string, patch: Partial<Clip>): Timeline =>
  ({ ...tl, clips: tl.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
export const updateText = (tl: Timeline, id: string, patch: Partial<TextItem>): Timeline =>
  ({ ...tl, texts: tl.texts.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

export function moveClip(tl: Timeline, from: number, to: number): Timeline {
  const clips = [...tl.clips];
  const [c] = clips.splice(from, 1);
  clips.splice(to > from ? to - 1 : to, 0, c);
  return { ...tl, clips };
}

/** Splits the clip under the playhead into two hard-cut clips. */
export function splitAt(tl: Timeline, layout: Layout, t: number): { tl: Timeline; id: string } | null {
  const li = [...activeClips(layout, t)].pop();
  if (!li) return null;
  const c = li.clip;
  const at = c.in + (t - li.start) * c.speed;
  if (at - c.in < 0.1 || c.out - at < 0.1) return null;
  const a: Clip = { ...c, out: Math.round(at * 1000) / 1000, transition: 'cut' };
  const b: Clip = { ...c, id: uid('c'), in: Math.round(at * 1000) / 1000 };
  const clips = [...tl.clips];
  clips.splice(li.index, 1, a, b);
  return { tl: { ...tl, clips }, id: b.id };
}

/** Keeps only the spoken parts of a clip: drops pauses over 0.4 s and filler words like "um". */
export function removeSilences(tl: Timeline, clipId: string, media: Media): { tl: Timeline; removed: number } {
  const idx = tl.clips.findIndex((c) => c.id === clipId);
  const c = tl.clips[idx];
  const words = media.transcript.words.filter((w) => w.end > c.in && w.start < c.out
    && !FILLERS.has(w.text.toLowerCase().replace(/[^a-z]/g, '')));
  if (!words.length) return { tl, removed: 0 };
  const ranges: [number, number][] = [];
  for (const w of words) {
    const s = Math.max(c.in, w.start - 0.08);
    const e = Math.min(c.out, w.end + 0.12);
    const last = ranges[ranges.length - 1];
    if (last && s - last[1] < 0.4) last[1] = e;
    else ranges.push([s, e]);
  }
  const kept = ranges.reduce((a, [s, e]) => a + e - s, 0);
  const pieces: Clip[] = ranges.map(([s, e], i) => ({
    ...c, id: i ? uid('c') : c.id, in: Math.round(s * 1000) / 1000, out: Math.round(e * 1000) / 1000,
    transition: i === ranges.length - 1 ? c.transition : 'cut',
  }));
  const clips = [...tl.clips];
  clips.splice(idx, 1, ...pieces);
  return { tl: { ...tl, clips }, removed: (c.out - c.in - kept) / c.speed };
}

/** Moves every cut to the nearest music beat (within half a shot), trimming clip ends. */
export function snapCutsToBeats(tl: Timeline, mediaMap: Map<string, Media>): Timeline {
  const music = tl.music && mediaMap.get(tl.music.mediaId);
  if (!tl.music || !music?.beats?.length) return tl;
  const beats = music.beats.map((b) => b - tl.music!.start).filter((b) => b > 0.3);
  let clips = [...tl.clips];
  for (let i = 0; i < clips.length - 1; i++) {
    const li = layoutClips(clips).items[i];
    const cut = li.end - li.tOut / 2;
    const best = beats.reduce((a, b) => (Math.abs(b - cut) < Math.abs(a - cut) ? b : a), Infinity);
    if (!Number.isFinite(best) || Math.abs(best - cut) > li.dur / 2) continue;
    const c = clips[i];
    const m = mediaMap.get(c.mediaId);
    const maxOut = m?.kind === 'image' ? 60 : m?.duration ?? c.out;
    const out = clamp(c.out + (best - cut) * c.speed, c.in + 0.2, maxOut);
    clips = clips.map((x, j) => (j === i ? { ...x, out: Math.round(out * 1000) / 1000 } : x));
  }
  return { ...tl, clips };
}

export type CaptionWord = { start: number; end: number; text: string; key: string };
export type CaptionPage = { id: number; start: number; end: number; words: CaptionWord[] };

/** Every transcribed word that is heard on the reel, mapped from source time to reel time. */
export function reelWords(tl: Timeline, layout: Layout, mediaMap: Map<string, Media>): CaptionWord[] {
  const out: CaptionWord[] = [];
  for (const li of layout.items) {
    const c = li.clip;
    const m = mediaMap.get(c.mediaId);
    // 'low' = Whisper heard noise or non-English speech; captions from it would be nonsense.
    if (!m || m.kind !== 'video' || m.transcript.status !== 'done' || m.transcript.quality === 'low' || c.volume <= 0.01) continue;
    m.transcript.words.forEach((w, i) => {
      const mid = (w.start + w.end) / 2;
      if (mid < c.in || mid >= c.out) return;
      const key = `${m.id}:${i}`;
      const text = (tl.captions.overrides[key] ?? w.text).trim();
      const start = li.start + (Math.max(w.start, c.in) - c.in) / c.speed;
      const end = Math.min(li.end, li.start + (Math.min(w.end, c.out) - c.in) / c.speed);
      if (text && start < li.end) out.push({ start, end, text, key });
    });
  }
  return out;
}

/** Groups words into caption "pages" of a few words, breaking on pauses and sentence ends. */
export function captionPages(words: CaptionWord[], perPage: number): CaptionPage[] {
  const pages: CaptionPage[] = [];
  let cur: CaptionPage | null = null;
  for (const w of words) {
    const last = cur?.words[cur.words.length - 1];
    const chars = cur ? cur.words.reduce((a, x) => a + x.text.length + 1, 0) : 0;
    if (!cur || !last || cur.words.length >= perPage || w.start - last.end > 0.6
      || /[.!?]$/.test(last.text) || (perPage > 1 && chars + w.text.length > 24)) {
      cur = { id: pages.length, start: w.start, end: w.end, words: [] };
      pages.push(cur);
    }
    cur.words.push(w);
    cur.end = w.end;
  }
  pages.forEach((p, i) => { p.end = Math.min(pages[i + 1]?.start ?? Infinity, p.end + 0.4); });
  return pages;
}

/** Speech regions on the reel (for ducking music), merging gaps shorter than 0.5 s. */
export function speechRegions(words: CaptionWord[]) {
  const regions: { start: number; end: number }[] = [];
  for (const w of words) {
    const last = regions[regions.length - 1];
    if (last && w.start - last.end < 0.5) last.end = Math.max(last.end, w.end);
    else regions.push({ start: w.start, end: w.end });
  }
  return regions;
}

/** Music gain at time t: ducking under speech (0.2 s ramps, same as the ffmpeg expression) and fades. */
export function musicGain(tl: Timeline, regions: { start: number; end: number }[], t: number, total: number) {
  const m = tl.music;
  if (!m) return 0;
  let d = 0;
  if (m.duck) {
    for (const r of regions) d = Math.max(d, clamp(Math.min((t - (r.start - 0.2)) / 0.2, (r.end + 0.2 - t) / 0.2), 0, 1));
  }
  let g = m.volume * (1 - (1 - m.duckLevel) * d);
  if (m.fadeIn > 0) g *= clamp(t / m.fadeIn, 0, 1);
  if (m.fadeOut > 0) g *= clamp((total - t) / m.fadeOut, 0, 1);
  return g;
}

export const fmtTime = (t: number, frames = false) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * FPS);
  return `${m}:${String(s).padStart(2, '0')}${frames ? `.${String(f).padStart(2, '0')}` : ''}`;
};
