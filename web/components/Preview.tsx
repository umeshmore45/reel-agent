'use client';

import { useEffect, useRef, useState } from 'react';
import { fileUrl, mediaSrc } from '@/lib/api';
import { NO_LOOK, drawClipFrame, drawOverlay, drawTransition, fadeLevel, overlayOps, type Bounds } from '@/lib/draw';
import { playhead } from '@/lib/playhead';
import { activeClips, clamp, musicGain, type CaptionPage, type ClipLayout, type Layout } from '@/lib/timeline';
import type { Media, Project, Selection, Timeline } from '@/lib/types';

// 3/4 of the export size: sharp on retina screens without slowing playback.
const PW = 810;
const PH = 1440;

export type DragTarget = { kind: 'text'; id: string } | { kind: 'captions' };

type Props = {
  project: Project;
  timeline: Timeline;
  layout: Layout;
  pages: CaptionPage[];
  regions: { start: number; end: number }[];
  mediaMap: Map<string, Media>;
  playing: boolean;
  onEnded: () => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onOverlayDrag: (target: DragTarget, x: number, y: number, live: boolean) => void;
};

/**
 * Live 9:16 preview. Plays the timeline by driving one pair of <video> elements per media file
 * (adjacent clips use different elements, so the next clip can be pre-seeked and transitions can
 * show both), and draws every frame to a canvas with the same code the export uses for overlays.
 */
export default function Preview(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const images = useRef(new Map<string, HTMLImageElement>());
  const music = useRef<HTMLAudioElement | null>(null);
  const dirty = useRef(true);
  const clock = useRef({ t: 0, now: 0 });
  const bounds = useRef<Bounds[]>([]);
  const drag = useRef<{ target: DragTarget; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [safe, setSafe] = useState(false);
  const safeRef = useRef(safe);
  safeRef.current = safe;
  const guide = useRef(false);

  // Keep one video pair / image per media file, using the proxy once it exists.
  useEffect(() => {
    const host = hostRef.current!;
    const mark = () => { dirty.current = true; };
    const wanted = new Set<string>();
    for (const m of props.project.media) {
      if (m.status !== 'ready') continue;
      const src = mediaSrc(props.project.id, m);
      if (m.kind === 'video') {
        for (const k of [0, 1]) {
          const key = `${m.id}:${k}`;
          wanted.add(key);
          let el = videos.current.get(key);
          if (!el) {
            el = document.createElement('video');
            el.crossOrigin = 'anonymous';
            el.preload = 'auto';
            el.playsInline = true;
            el.addEventListener('seeked', mark);
            el.addEventListener('loadeddata', mark);
            host.appendChild(el);
            videos.current.set(key, el);
          }
          if (el.dataset.src !== src) {
            const t = el.currentTime;
            el.dataset.src = src;
            el.src = src;
            if (t) el.currentTime = t;
          }
        }
      } else if (m.kind === 'image' && !images.current.has(m.id)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = mark;
        img.src = src;
        images.current.set(m.id, img);
      }
    }
    for (const [key, el] of videos.current) {
      if (wanted.has(key)) continue;
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
      videos.current.delete(key);
    }
    dirty.current = true;
  }, [props.project]);

  const musicMedia = props.timeline.music ? props.mediaMap.get(props.timeline.music.mediaId) : undefined;
  const musicSrc = musicMedia?.status === 'ready' ? fileUrl(props.project.id, musicMedia.file) : '';
  useEffect(() => {
    if (!musicSrc) { music.current?.pause(); music.current = null; return; }
    const el = new Audio(musicSrc);
    el.preload = 'auto';
    music.current = el;
    return () => { el.pause(); };
  }, [musicSrc]);

  useEffect(() => { dirty.current = true; }, [props.timeline, props.selection, props.pages, safe]);

  useEffect(() => {
    if (props.playing) {
      let t = playhead.get();
      if (t >= props.layout.total - 0.05) { t = 0; playhead.set(0); }
      clock.current = { t, now: performance.now() };
    } else {
      videos.current.forEach((el) => el.pause());
      music.current?.pause();
      dirty.current = true;
    }
  }, [props.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => playhead.subscribe((t, fromPlayback) => {
    if (fromPlayback) return;
    clock.current = { t, now: performance.now() };
    dirty.current = true;
  }), []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = propsRef.current;
      let t = playhead.get();
      if (p.playing) {
        t = clock.current.t + (performance.now() - clock.current.now) / 1000;
        if (t >= p.layout.total) {
          t = p.layout.total;
          p.onEnded();
        }
        playhead.set(t, true);
      }
      sync(t, p.playing);
      if (p.playing || dirty.current) {
        dirty.current = false;
        draw(t);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const videoFor = (li: ClipLayout) => videos.current.get(`${li.clip.mediaId}:${li.index % 2}`);

  function sync(t: number, playing: boolean) {
    const p = propsRef.current;
    const used = new Set<HTMLVideoElement>();
    const fade = fadeLevel(p.timeline.look ?? NO_LOOK, t, p.layout.total);
    for (const li of activeClips(p.layout, t)) {
      const m = p.mediaMap.get(li.clip.mediaId);
      const el = m?.kind === 'video' ? videoFor(li) : undefined;
      if (!el) continue;
      used.add(el);
      const c = li.clip;
      const src = Math.min(c.out, c.in + (t - li.start) * c.speed);
      let gain = c.volume * fade;
      if (li.tIn && t < li.start + li.tIn) gain *= (t - li.start) / li.tIn;
      if (li.tOut && t > li.end - li.tOut) gain *= (li.end - t) / li.tOut;
      el.volume = clamp(gain, 0, 1);
      if (playing) {
        if (el.playbackRate !== c.speed) el.playbackRate = c.speed;
        if (el.paused) {
          if (Math.abs(el.currentTime - src) > 0.05) el.currentTime = src;
          el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - src) > 0.25) el.currentTime = src;
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - src) > 0.02) el.currentTime = src;
      }
    }
    // Pre-seek the next clip so the cut doesn't stall.
    const next = p.layout.items.find((li) => li.start > t && li.start - t < 1);
    const nel = next && p.mediaMap.get(next.clip.mediaId)?.kind === 'video' ? videoFor(next) : undefined;
    if (next && nel && !used.has(nel)) {
      used.add(nel);
      if (!nel.paused) nel.pause();
      if (!nel.seeking && Math.abs(nel.currentTime - next.clip.in) > 0.05) nel.currentTime = next.clip.in;
    }
    videos.current.forEach((el) => { if (!used.has(el) && !el.paused) el.pause(); });

    const me = music.current;
    const mu = p.timeline.music;
    const mm = mu && p.mediaMap.get(mu.mediaId);
    if (me && mu && mm && t < p.layout.total) {
      me.volume = clamp(musicGain(p.timeline, p.regions, t, p.layout.total) * fade, 0, 1);
      const mt = mm.duration > 0 ? (mu.start + t) % mm.duration : mu.start + t;
      if (playing) {
        if (me.paused) { me.currentTime = mt; me.play().catch(() => {}); }
        else if (Math.abs(me.currentTime - mt) > 0.3) me.currentTime = mt;
      } else if (!me.paused) me.pause();
    } else if (me && !me.paused) me.pause();
  }

  function draw(t: number) {
    const p = propsRef.current;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, PW, PH);

    const drawLi = (li: ClipLayout) => () => {
      const m = p.mediaMap.get(li.clip.mediaId);
      if (m?.kind === 'image') {
        const img = images.current.get(m.id);
        if (img?.complete && img.naturalWidth) drawClipFrame(ctx, li.clip, img, img.naturalWidth, img.naturalHeight, t - li.start, li.dur, PW, PH);
      } else {
        const el = videoFor(li);
        if (el && el.readyState >= 2) drawClipFrame(ctx, li.clip, el, el.videoWidth, el.videoHeight, t - li.start, li.dur, PW, PH);
      }
    };
    const act = activeClips(p.layout, t);
    if (act.length >= 2) {
      const [a, b] = act;
      drawTransition(ctx, a.clip.transition, clamp((t - b.start) / a.tOut, 0, 1), drawLi(a), drawLi(b), PW, PH);
    } else if (act.length === 1) drawLi(act[0])();

    if (!p.layout.items.length) {
      ctx.fillStyle = '#52525b';
      ctx.font = '600 18px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Upload clips, then ask the agent', PW / 2, PH / 2 - 12);
      ctx.fillText('or press + on a clip to start', PW / 2, PH / 2 + 16);
    }

    const sel = p.selection;
    const settle = !p.playing && sel?.kind === 'text' ? sel.id : undefined;
    bounds.current = drawOverlay(ctx, overlayOps(p.timeline, p.pages, t, p.layout.total, settle), p.timeline.captions, PW, PH);

    const selId = sel?.kind === 'text' ? sel.id : sel?.kind === 'captions' ? 'captions' : null;
    const b = selId && bounds.current.find((x) => x.id === selId);
    if (b) {
      ctx.save();
      ctx.strokeStyle = '#a78bfa';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(b.x - 5, b.y - 5, b.w + 10, b.h + 10);
      ctx.restore();
    }
    if (safeRef.current || drag.current?.moved) {
      ctx.save();
      ctx.fillStyle = 'rgba(239,68,68,0.12)';
      ctx.fillRect(0, PH * 0.8, PW, PH * 0.2);
      ctx.fillRect(PW * 0.86, PH * 0.35, PW * 0.14, PH * 0.45);
      ctx.fillRect(0, 0, PW, PH * 0.1);
      ctx.restore();
    }
    if (guide.current) {
      ctx.save();
      ctx.strokeStyle = '#f0abfc';
      ctx.beginPath();
      ctx.moveTo(PW / 2, 0);
      ctx.lineTo(PW / 2, PH);
      ctx.stroke();
      ctx.restore();
    }
  }

  const toCanvas = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * PW, y: ((e.clientY - r.top) / r.height) * PH };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toCanvas(e);
    const p = propsRef.current;
    const hit = [...bounds.current].reverse().find((b) => x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6);
    if (hit) {
      const target: DragTarget = hit.id === 'captions' ? { kind: 'captions' } : { kind: 'text', id: hit.id };
      const item = target.kind === 'text' ? p.timeline.texts.find((t) => t.id === target.id) : null;
      p.onSelect(target.kind === 'text' ? { kind: 'text', id: target.id } : { kind: 'captions' });
      drag.current = { target, sx: x, sy: y, ox: item ? item.x : 0.5, oy: item ? item.y : p.timeline.captions.y, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const li = [...activeClips(p.layout, playhead.get())].pop();
    p.onSelect(li ? { kind: 'clip', id: li.clip.id } : null);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = toCanvas(e);
    if (!d.moved && Math.hypot(x - d.sx, y - d.sy) < 3) return;
    d.moved = true;
    let nx = clamp(d.ox + (x - d.sx) / PW, 0.05, 0.95);
    const ny = clamp(d.oy + (y - d.sy) / PH, 0.05, 0.95);
    guide.current = d.target.kind === 'text' && Math.abs(nx - 0.5) < 0.015;
    if (guide.current) nx = 0.5;
    propsRef.current.onOverlayDrag(d.target, Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000, true);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    guide.current = false;
    dirty.current = true;
    if (d?.moved) propsRef.current.onOverlayDrag(d.target, NaN, NaN, false);
  };

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div className="relative aspect-[9/16] h-full max-h-full max-w-full overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/60 ring-1 ring-white/10">
        <canvas
          ref={canvasRef} width={PW} height={PH}
          className="h-full w-full cursor-pointer touch-none"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        />
      </div>
      <button
        type="button" onClick={() => setSafe((s) => !s)} title="Show the areas platform buttons cover"
        className={`absolute right-3 top-3 rounded-md px-2 py-1 text-[11px] ${safe ? 'bg-red-500/20 text-red-200' : 'bg-white/5 text-zinc-400 hover:text-white'}`}
      >
        Safe zones
      </button>
      <div ref={hostRef} aria-hidden className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0" />
    </div>
  );
}
