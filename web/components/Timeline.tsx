'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fileUrl } from '@/lib/api';
import { playhead, usePlayheadTime } from '@/lib/playhead';
import { clamp, fmtTime, moveClip, updateClip, updateText, type CaptionPage, type ClipLayout, type Layout } from '@/lib/timeline';
import type { Media, Selection, TextItem, Timeline as TL } from '@/lib/types';
import { Btn } from './ui';

const LABEL_W = 84;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const MEDIA_DRAG_TYPE = 'application/x-reel-media';

type Props = {
  projectId: string;
  timeline: TL;
  layout: Layout;
  pages: CaptionPage[];
  mediaMap: Map<string, Media>;
  selection: Selection;
  onSelect: (s: Selection) => void;
  apply: (fn: (tl: TL) => TL, opts?: { live?: boolean }) => void;
  endLive: () => void;
  playing: boolean;
  onTogglePlay: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAddText: () => void;
  onDropMedia: (mediaId: string, index: number) => void;
};

function lanes(texts: TextItem[]) {
  const ends: number[] = [];
  const lane = new Map<string, number>();
  [...texts].sort((a, b) => a.start - b.start).forEach((t) => {
    let i = ends.findIndex((e) => e <= t.start + 0.01);
    if (i === -1) { i = ends.length; ends.push(0); }
    ends[i] = t.end;
    lane.set(t.id, i);
  });
  return { lane, count: Math.max(1, ends.length) };
}

export default function Timeline(p: Props) {
  const [pps, setPps] = useState(48);
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ id: string; dx: number; to: number } | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const time = usePlayheadTime(15);
  const total = p.layout.total;
  const width = Math.max(total + 6, 20) * pps;
  const { lane, count } = useMemo(() => lanes(p.timeline.texts), [p.timeline.texts]);
  const fitted = useRef(false);

  const fit = () => {
    const w = (scrollRef.current?.clientWidth ?? 800) - LABEL_W - 48;
    if (total > 0) setPps(clamp(w / total, 6, 240));
  };
  useEffect(() => {
    if (!fitted.current && total > 0) { fitted.current = true; fit(); }
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const place = (t: number) => {
      if (!lineRef.current) return;
      const x = t * ppsRef.current;
      lineRef.current.style.transform = `translateX(${x}px)`;
      const sc = scrollRef.current;
      if (sc && p.playing && (x + LABEL_W > sc.scrollLeft + sc.clientWidth - 40 || x + LABEL_W < sc.scrollLeft)) sc.scrollLeft = x;
    };
    place(playhead.get());
    return playhead.subscribe(place);
  }, [pps, p.playing]);

  const timeAt = (clientX: number) => {
    const r = contentRef.current!.getBoundingClientRect();
    return clamp((clientX - r.left) / ppsRef.current, 0, total);
  };

  const snapCandidates = (skip?: string) => {
    const c = [playhead.get(), 0, total];
    p.layout.items.forEach((li) => c.push(li.start, li.end));
    p.timeline.texts.forEach((t) => { if (t.id !== skip) c.push(t.start, t.end); });
    p.pages.forEach((pg) => c.push(pg.start));
    const mu = p.timeline.music;
    if (mu) {
      p.mediaMap.get(mu.mediaId)?.beats?.forEach((b) => { if (b - mu.start >= 0 && b - mu.start <= total + 5) c.push(b - mu.start); });
    }
    return c;
  };
  const snap = (t: number, cands: number[]) => {
    let best = t;
    let dist = 8 / ppsRef.current;
    for (const c of cands) if (Math.abs(c - t) < dist) { dist = Math.abs(c - t); best = c; }
    return best;
  };

  const startSeek = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    playhead.set(timeAt(e.clientX));
    const move = (ev: PointerEvent) => playhead.set(timeAt(ev.clientX));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
  };

  const dragLoop = (e: React.PointerEvent, onMove: (dx: number, ev: PointerEvent) => void, onUp: (moved: boolean) => void) => {
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      if (!moved && Math.abs(dx) < 4) return;
      moved = true;
      onMove(dx, ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => { window.removeEventListener('pointermove', move); onUp(moved); }, { once: true });
  };

  const onClipDown = (e: React.PointerEvent, li: ClipLayout, mode: 'move' | 'in' | 'out') => {
    const base = li.clip;
    const m = p.mediaMap.get(base.mediaId);
    p.onSelect({ kind: 'clip', id: base.id });
    const cands = snapCandidates();
    let to = li.index;
    dragLoop(e, (dx, ev) => {
      const dt = dx / ppsRef.current;
      if (mode === 'in') {
        if (m?.kind === 'image') p.apply((tl) => updateClip(tl, base.id, { out: r3(clamp(base.out - dt, 0.3, 60)) }), { live: true });
        else p.apply((tl) => updateClip(tl, base.id, { in: r3(clamp(base.in + dt * base.speed, 0, base.out - 0.2)) }), { live: true });
      } else if (mode === 'out') {
        const maxOut = m?.kind === 'image' ? 60 : m?.duration ?? base.out;
        const end = snap(li.start + (base.out - base.in) / base.speed + dt, cands);
        const out = clamp(base.in + (end - li.start) * base.speed, base.in + 0.2, maxOut);
        p.apply((tl) => updateClip(tl, base.id, { out: r3(out) }), { live: true });
      } else {
        const t = timeAt(ev.clientX);
        to = p.layout.items.filter((x) => x.start + x.dur / 2 < t).length;
        setDragging({ id: base.id, dx, to });
      }
    }, (moved) => {
      if (mode === 'move') {
        setDragging(null);
        if (moved && to !== li.index && to !== li.index + 1) p.apply((tl) => moveClip(tl, li.index, to));
      } else p.endLive();
    });
  };

  const onTextDown = (e: React.PointerEvent, t: TextItem, mode: 'move' | 'start' | 'end') => {
    p.onSelect({ kind: 'text', id: t.id });
    const cands = snapCandidates(t.id);
    const len = t.end - t.start;
    dragLoop(e, (dx) => {
      const dt = dx / ppsRef.current;
      let patch: Partial<TextItem>;
      if (mode === 'move') {
        const start = Math.max(0, snap(t.start + dt, cands));
        patch = { start: r3(start), end: r3(start + len) };
      } else if (mode === 'start') patch = { start: r3(clamp(snap(t.start + dt, cands), 0, t.end - 0.3)) };
      else patch = { end: r3(Math.max(t.start + 0.3, snap(t.end + dt, cands))) };
      p.apply((tl) => updateText(tl, t.id, patch), { live: true });
    }, () => p.endLive());
  };

  const sel = p.selection;
  const music = p.timeline.music;
  const musicMedia = music ? p.mediaMap.get(music.mediaId) : undefined;
  const step = pps >= 60 ? 1 : pps >= 25 ? 2 : pps >= 10 ? 5 : 10;
  const textH = count * 26 + 8;

  return (
    <div className="flex h-full flex-col border-t border-white/10 bg-zinc-950">
      <div className="flex items-center gap-1 border-b border-white/5 px-3 py-1.5">
        <button
          type="button" onClick={p.onTogglePlay} title="Play / pause (Space)"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black hover:bg-zinc-200"
        >
          {p.playing ? <span className="text-sm">❚❚</span> : <span className="ml-0.5 text-sm">▶</span>}
        </button>
        <div className="mx-2 w-36 font-mono text-xs tabular-nums text-zinc-300">
          {fmtTime(time, true)} <span className="text-zinc-600">/ {fmtTime(total, true)}</span>
        </div>
        <Btn onClick={p.onSplit} title="Split at playhead (S)">✂ Split</Btn>
        <Btn onClick={p.onDuplicate} title="Duplicate (D)" disabled={!sel || sel.kind === 'captions' || sel.kind === 'music'}>⧉ Duplicate</Btn>
        <Btn onClick={p.onDelete} title="Delete (Backspace)" disabled={!sel}>🗑 Delete</Btn>
        <Btn onClick={p.onAddText} title="Add text at playhead (T)">＋ Text</Btn>
        <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
          <span>Zoom</span>
          <input type="range" min={6} max={240} value={pps} onChange={(e) => setPps(Number(e.target.value))} className="w-28" />
          <Btn onClick={fit}>Fit</Btn>
        </div>
      </div>

      <div ref={scrollRef} className="relative flex-1 overflow-auto">
        <div className="relative" style={{ width: width + LABEL_W }}>
          <Row label="" height={22}>
            <div ref={contentRef} className="absolute inset-0 cursor-col-resize" onPointerDown={startSeek}>
              {Array.from({ length: Math.ceil(width / pps / step) + 1 }, (_, i) => i * step).map((s) => (
                <div key={s} className="absolute top-0 h-full border-l border-white/10 pl-1 text-[10px] text-zinc-500" style={{ left: s * pps }}>
                  {fmtTime(s)}
                </div>
              ))}
            </div>
          </Row>

          <Row label="Text" height={textH} onBackground={startSeek}>
            {p.timeline.texts.map((t) => {
              const active = sel?.kind === 'text' && sel.id === t.id;
              return (
                <div
                  key={t.id}
                  onPointerDown={(e) => onTextDown(e, t, 'move')}
                  className={`absolute flex h-[22px] cursor-grab items-center overflow-hidden rounded-md px-2 text-[11px] font-medium text-white ${
                    active ? 'bg-amber-500 ring-2 ring-white' : 'bg-amber-600/80 hover:bg-amber-500'}`}
                  style={{ left: t.start * pps, width: Math.max(8, (t.end - t.start) * pps), top: 4 + (lane.get(t.id) ?? 0) * 26 }}
                >
                  <Handle side="left" onDown={(e) => onTextDown(e, t, 'start')} />
                  <span className="truncate">{t.text}</span>
                  <Handle side="right" onDown={(e) => onTextDown(e, t, 'end')} />
                </div>
              );
            })}
          </Row>

          <Row label="Video" height={68} onBackground={startSeek}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return;
              e.preventDefault();
              const t = timeAt(e.clientX);
              setDropAt(p.layout.items.filter((x) => x.start + x.dur / 2 < t).length);
            }}
            onDragLeave={() => setDropAt(null)}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(MEDIA_DRAG_TYPE);
              if (id && dropAt !== null) p.onDropMedia(id, dropAt);
              setDropAt(null);
            }}
          >
            {p.layout.items.map((li) => {
              const m = p.mediaMap.get(li.clip.mediaId);
              const c = li.clip;
              const active = sel?.kind === 'clip' && sel.id === c.id;
              const drag = dragging?.id === c.id ? dragging : null;
              return (
                <div
                  key={c.id}
                  onPointerDown={(e) => onClipDown(e, li, 'move')}
                  className={`group absolute top-1.5 h-14 cursor-grab overflow-hidden rounded-lg border bg-zinc-800 ${
                    active ? 'z-10 border-violet-400 ring-2 ring-violet-500' : 'border-white/10 hover:border-white/30'} ${drag ? 'z-30 opacity-80 shadow-2xl' : ''}`}
                  style={{
                    left: li.start * pps,
                    width: Math.max(6, li.dur * pps),
                    transform: drag ? `translateX(${drag.dx}px)` : undefined,
                    backgroundImage: m?.thumb ? `url(${fileUrl(p.projectId, m.thumb)})` : undefined,
                    backgroundSize: 'auto 100%',
                    backgroundRepeat: 'repeat-x',
                  }}
                >
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                  <div className="pointer-events-none absolute bottom-1 left-2 right-2 flex items-center gap-1 truncate text-[10px] font-medium text-white">
                    <span className="truncate">{m?.name ?? 'missing'}</span>
                    <span className="text-white/60">{li.dur.toFixed(1)}s</span>
                    {c.speed !== 1 && <Badge>{c.speed}×</Badge>}
                    {c.filter !== 'none' && <Badge>{c.filter}</Badge>}
                    {c.zoom !== 'none' && <Badge>zoom</Badge>}
                    {m?.kind === 'video' && c.volume === 0 && <Badge>muted</Badge>}
                  </div>
                  <Handle side="left" onDown={(e) => onClipDown(e, li, 'in')} big />
                  <Handle side="right" onDown={(e) => onClipDown(e, li, 'out')} big />
                </div>
              );
            })}
            {p.layout.items.slice(0, -1).map((li) => (
              <button
                key={`tr-${li.clip.id}`} type="button" title={`Transition: ${li.clip.transition}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => p.onSelect({ kind: 'clip', id: li.clip.id })}
                className={`absolute top-0 z-20 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full text-[9px] ${
                  li.clip.transition === 'cut' ? 'bg-zinc-700 text-zinc-400 opacity-0 hover:opacity-100' : 'bg-fuchsia-500 text-white'}`}
                style={{ left: (li.end - li.tOut / 2) * pps }}
              >
                ◆
              </button>
            ))}
            {(dragging || dropAt !== null) && (() => {
              const idx = dragging ? dragging.to : dropAt!;
              const x = idx < p.layout.items.length ? p.layout.items[idx].start : total;
              return <div className="absolute top-0 z-40 h-full w-0.5 bg-fuchsia-400" style={{ left: x * pps }} />;
            })()}
            {!p.layout.items.length && (
              <div className="absolute inset-y-2 left-2 flex items-center rounded-lg border border-dashed border-white/15 px-4 text-xs text-zinc-500">
                Drag clips here from the library, or ask the agent to edit
              </div>
            )}
          </Row>

          <Row label="Captions" height={28} onBackground={startSeek} dim={!p.timeline.captions.enabled}>
            {p.pages.map((pg) => (
              <div
                key={pg.id}
                onPointerDown={(e) => { e.stopPropagation(); p.onSelect({ kind: 'captions' }); playhead.set(pg.start); }}
                className={`absolute top-1 h-5 cursor-pointer truncate rounded px-1.5 text-[10px] leading-5 text-sky-100 ${
                  sel?.kind === 'captions' ? 'bg-sky-500/70' : 'bg-sky-700/60 hover:bg-sky-600/70'}`}
                style={{ left: pg.start * pps, width: Math.max(4, (pg.end - pg.start) * pps - 1) }}
              >
                {pg.words.map((w) => w.text).join(' ')}
              </div>
            ))}
          </Row>

          <Row label="Music" height={46} onBackground={startSeek}>
            {music && musicMedia ? (
              <div
                onPointerDown={(e) => { e.stopPropagation(); p.onSelect({ kind: 'music' }); }}
                className={`absolute top-1 h-9 cursor-pointer overflow-hidden rounded-lg border ${
                  sel?.kind === 'music' ? 'border-emerald-300 ring-2 ring-emerald-500' : 'border-emerald-500/30'} bg-emerald-900/50`}
                style={{ left: 0, width: Math.max(10, total * pps) }}
              >
                <Waveform media={musicMedia} start={music.start} total={total} pps={pps} />
                <div className="pointer-events-none absolute left-2 top-0.5 text-[10px] font-medium text-emerald-100">
                  ♪ {musicMedia.name} {musicMedia.bpm ? `· ${Math.round(musicMedia.bpm)} BPM` : ''}
                </div>
              </div>
            ) : (
              <button
                type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => p.onSelect({ kind: 'music' })}
                className="absolute inset-y-1.5 left-2 rounded-lg border border-dashed border-white/15 px-3 text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                ＋ Add music
              </button>
            )}
          </Row>

          <div className="pointer-events-none absolute bottom-0 top-0 z-50" style={{ left: LABEL_W }}>
            <div ref={lineRef} className="absolute top-0 h-full w-px bg-white">
              <div className="absolute -left-[5px] -top-0.5 h-3 w-[11px] rounded-b bg-white" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, height, children, onBackground, dim, ...drop }: {
  label: string; height: number; children: ReactNode; onBackground?: (e: React.PointerEvent) => void; dim?: boolean;
  onDragOver?: (e: React.DragEvent) => void; onDragLeave?: () => void; onDrop?: (e: React.DragEvent) => void;
}) {
  return (
    <div className="flex border-b border-white/5" style={{ height }}>
      <div className="sticky left-0 z-40 flex shrink-0 items-center border-r border-white/5 bg-zinc-950 px-3 text-[11px] font-medium text-zinc-500" style={{ width: LABEL_W }}>
        {label}
      </div>
      <div className={`relative flex-1 ${dim ? 'opacity-40' : ''}`} onPointerDown={onBackground} {...drop}>
        {children}
      </div>
    </div>
  );
}

function Handle({ side, onDown, big }: { side: 'left' | 'right'; onDown: (e: React.PointerEvent) => void; big?: boolean }) {
  return (
    <div
      onPointerDown={onDown}
      className={`absolute top-0 z-10 h-full ${big ? 'w-2' : 'w-1.5'} cursor-ew-resize bg-white/0 hover:bg-white/70 ${side === 'left' ? 'left-0' : 'right-0'}`}
    />
  );
}

const Badge = ({ children }: { children: ReactNode }) => (
  <span className="rounded bg-black/50 px-1 text-[9px] uppercase text-white/80">{children}</span>
);

function Waveform({ media, start, total, pps }: { media: Media; start: number; total: number; pps: number }) {
  const path = useMemo(() => {
    const peaks = media.peaks || [];
    if (!peaks.length) return '';
    const w = total * pps;
    const parts: string[] = [];
    for (let x = 0; x < w; x += 2) {
      const t = start + x / pps;
      const v = peaks[Math.floor(t * 50) % peaks.length] || 0;
      const h = Math.max(1, v * 30);
      parts.push(`M${x} ${36 - h}V36`);
    }
    return parts.join('');
  }, [media.peaks, start, total, pps]);
  const beats = (media.beats || []).map((b) => b - start).filter((b) => b >= 0 && b <= total);
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none">
      <path d={path} stroke="rgba(110,231,183,0.55)" strokeWidth={1.2} />
      {pps * ((60 / (media.bpm || 120))) > 5 && beats.map((b) => (
        <line key={b} x1={b * pps} x2={b * pps} y1={26} y2={36} stroke="rgba(255,255,255,0.45)" strokeWidth={1} />
      ))}
    </svg>
  );
}
