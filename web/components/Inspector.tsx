'use client';

import { fileUrl } from '@/lib/api';
import { FILTERS, SWATCHES, TEXT_ANIMS, TEXT_STYLES, TRANSITIONS } from '@/lib/constants';
import { FONTS } from '@/lib/fonts';
import { playhead } from '@/lib/playhead';
import { clamp, updateClip, updateText, type CaptionPage, type Layout } from '@/lib/timeline';
import type { Clip, FontId, Media, Selection, TextItem, Timeline } from '@/lib/types';
import { CaptionsSettings, MusicSettings } from './Settings';
import { Btn, ColorRow, NumberField, Section, Segmented, Slider } from './ui';

type Apply = (fn: (tl: Timeline) => Timeline, opts?: { live?: boolean }) => void;

type Props = {
  projectId: string;
  timeline: Timeline;
  layout: Layout;
  pages: CaptionPage[];
  media: Media[];
  mediaMap: Map<string, Media>;
  selection: Selection;
  apply: Apply;
  endLive: () => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRemoveSilences: (clipId: string) => void;
};

export default function Inspector(p: Props) {
  const sel = p.selection;
  if (!sel) {
    return (
      <div className="p-6 text-center text-sm text-zinc-500">
        Select a clip, text, caption or the music track on the timeline to edit it.
        <div className="mt-6 space-y-1 text-left text-xs text-zinc-600">
          <div><Kbd>Space</Kbd> play / pause</div>
          <div><Kbd>S</Kbd> split at playhead</div>
          <div><Kbd>T</Kbd> add text</div>
          <div><Kbd>D</Kbd> duplicate · <Kbd>⌫</Kbd> delete</div>
          <div><Kbd>←</Kbd> <Kbd>→</Kbd> step a frame (⇧ = 1 s)</div>
          <div><Kbd>⌘Z</Kbd> undo · <Kbd>⇧⌘Z</Kbd> redo</div>
        </div>
      </div>
    );
  }
  if (sel.kind === 'captions') return <CaptionsSettings timeline={p.timeline} pages={p.pages} media={p.media} apply={p.apply} endLive={p.endLive} />;
  if (sel.kind === 'music') return <MusicSettings timeline={p.timeline} media={p.media} mediaMap={p.mediaMap} apply={p.apply} endLive={p.endLive} />;
  if (sel.kind === 'text') {
    const t = p.timeline.texts.find((x) => x.id === sel.id);
    return t ? <TextInspector {...p} item={t} /> : null;
  }
  const li = p.layout.items.find((x) => x.clip.id === sel.id);
  return li ? <ClipInspector {...p} clip={li.clip} index={li.index} /> : null;
}

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="mr-1 rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 font-sans text-[10px] text-zinc-300">{children}</kbd>
);

function ClipInspector(p: Props & { clip: Clip; index: number }) {
  const c = p.clip;
  const m = p.mediaMap.get(c.mediaId);
  const li = p.layout.items[p.index];
  const isLast = p.index === p.timeline.clips.length - 1;
  const set = (patch: Partial<Clip>, live = false) => p.apply((tl) => updateClip(tl, c.id, patch), { live });
  const maxOut = m?.kind === 'image' ? 60 : m?.duration ?? c.out;
  const srcAtPlayhead = () => clamp(c.in + (playhead.get() - li.start) * c.speed, 0, maxOut);
  const thumb = m?.thumb ? fileUrl(p.projectId, m.thumb) : '';

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
        {thumb && <img src={thumb} alt="" className="h-12 w-12 rounded-md object-cover" />}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-zinc-100">{m?.name}</div>
          <div className="text-xs text-zinc-500">Clip {p.index + 1} · {li.dur.toFixed(2)} s on the reel</div>
        </div>
      </div>

      <Section title="Trim">
        {m?.kind === 'image' ? (
          <Slider label="Duration" value={c.out} min={0.5} max={15} step={0.1} onChange={(out) => set({ out }, true)} onCommit={p.endLive} format={(v) => `${v.toFixed(1)}s`} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="In (source s)" value={c.in} min={0} max={c.out - 0.1} onChange={(v) => set({ in: clamp(v, 0, c.out - 0.1) })} />
              <NumberField label="Out (source s)" value={c.out} min={c.in + 0.1} max={maxOut} onChange={(v) => set({ out: clamp(v, c.in + 0.1, maxOut) })} />
            </div>
            <div className="flex gap-1">
              <Btn variant="soft" className="flex-1" onClick={() => set({ in: Math.min(srcAtPlayhead(), c.out - 0.1) })}>⇤ In at playhead</Btn>
              <Btn variant="soft" className="flex-1" onClick={() => set({ out: Math.max(srcAtPlayhead(), c.in + 0.1) })}>Out at playhead ⇥</Btn>
            </div>
          </>
        )}
      </Section>

      {m?.kind === 'video' && (
        <Section title="Speed & sound">
          <Segmented value={c.speed} options={[0.5, 1, 1.5, 2].map((s) => ({ id: s, label: `${s}×` }))} onChange={(speed) => set({ speed })} small />
          <Slider label="Speed" value={c.speed} min={0.25} max={4} step={0.05} onChange={(speed) => set({ speed }, true)} onCommit={p.endLive} format={(v) => `${v.toFixed(2)}×`} />
          <Slider label="Clip volume" value={c.volume} min={0} max={1} onChange={(volume) => set({ volume }, true)} onCommit={p.endLive} format={(v) => `${Math.round(v * 100)}%`} />
          {m.transcript.status === 'done' && m.transcript.quality !== 'low' && (
            <Btn variant="soft" className="w-full" onClick={() => p.onRemoveSilences(c.id)}>✂ Remove silences &amp; filler words</Btn>
          )}
        </Section>
      )}

      <Section title="Framing">
        <Segmented value={c.fit} options={[{ id: 'fill', label: 'Fill 9:16' }, { id: 'blur', label: 'Fit + blur' }]} onChange={(fit) => set({ fit })} small />
        {c.fit === 'fill' && (
          <>
            <Slider label="Focus left ↔ right" value={c.focusX} min={0} max={1} onChange={(focusX) => set({ focusX }, true)} onCommit={p.endLive} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Focus top ↕ bottom" value={c.focusY} min={0} max={1} onChange={(focusY) => set({ focusY }, true)} onCommit={p.endLive} format={(v) => `${Math.round(v * 100)}%`} />
          </>
        )}
        <div>
          <div className="mb-1 text-xs text-zinc-400">Motion</div>
          <Segmented value={c.zoom} options={[{ id: 'none', label: 'Still' }, { id: 'in', label: 'Zoom in' }, { id: 'out', label: 'Zoom out' }, { id: 'punch', label: 'Punch' }]}
            onChange={(zoom) => set(zoom === 'punch' && c.zoomAmount < 0.5 ? { zoom, zoomAmount: 1.5 } : zoom !== 'punch' && c.zoomAmount > 0.4 ? { zoom, zoomAmount: 0.12 } : { zoom })} small />
        </div>
        {c.zoom !== 'none' && (
          <>
            <Slider label="Zoom amount" value={c.zoomAmount} min={0.03} max={c.zoom === 'punch' ? 2.5 : 0.4} onChange={(zoomAmount) => set({ zoomAmount }, true)} onCommit={p.endLive}
              format={(v) => (c.zoom === 'punch' ? `${(1 + v).toFixed(1)}×` : `${Math.round(v * 100)}%`)} />
            <Slider label="Zoom toward ↔" value={c.zoomX ?? 0.5} min={0} max={1} onChange={(zoomX) => set({ zoomX }, true)} onCommit={p.endLive} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Zoom toward ↕" value={c.zoomY ?? 0.5} min={0} max={1} onChange={(zoomY) => set({ zoomY }, true)} onCommit={p.endLive} format={(v) => `${Math.round(v * 100)}%`} />
          </>
        )}
      </Section>

      <Section title="Colour" right={(c.filter !== 'none' || c.brightness || c.contrast !== 1 || c.saturation !== 1) ? (
        <button type="button" className="text-[11px] text-violet-300" onClick={() => set({ filter: 'none', brightness: 0, contrast: 1, saturation: 1 })}>Reset</button>
      ) : undefined}>
        <div className="grid grid-cols-5 gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" onClick={() => set({ filter: f.id })} title={f.label}
              className={`overflow-hidden rounded-md border text-[9px] ${c.filter === f.id ? 'border-violet-400 ring-1 ring-violet-500' : 'border-white/10'}`}>
              {thumb ? <img src={thumb} alt="" className="aspect-square w-full object-cover" style={{ filter: f.css || undefined }} /> : <div className="aspect-square bg-zinc-800" />}
              <div className="truncate bg-zinc-900 py-0.5 text-zinc-400">{f.label}</div>
            </button>
          ))}
        </div>
        <Slider label="Brightness" value={c.brightness} min={-0.3} max={0.3} onChange={(brightness) => set({ brightness }, true)} onCommit={p.endLive} format={(v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2))} />
        <Slider label="Contrast" value={c.contrast} min={0.5} max={1.6} onChange={(contrast) => set({ contrast }, true)} onCommit={p.endLive} />
        <Slider label="Saturation" value={c.saturation} min={0} max={2} onChange={(saturation) => set({ saturation }, true)} onCommit={p.endLive} />
      </Section>

      <Section title="Transition to next clip">
        {isLast ? <p className="text-xs text-zinc-500">This is the last clip.</p> : (
          <>
            <div className="grid grid-cols-4 gap-1">
              {TRANSITIONS.map((t) => (
                <button key={t.id} type="button" onClick={() => set({ transition: t.id })}
                  className={`rounded-md border px-1 py-1.5 text-[10px] ${c.transition === t.id ? 'border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-100' : 'border-white/10 bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            {c.transition !== 'cut' && (
              <Slider label="Duration" value={c.transitionDuration} min={0.1} max={1.5} step={0.05} onChange={(transitionDuration) => set({ transitionDuration }, true)} onCommit={p.endLive} format={(v) => `${v.toFixed(2)}s`} />
            )}
          </>
        )}
      </Section>

      <div className="flex flex-wrap gap-1 px-4 py-3">
        <Btn variant="soft" onClick={p.onSplit}>✂ Split</Btn>
        <Btn variant="soft" onClick={p.onDuplicate}>⧉ Duplicate</Btn>
        <Btn variant="danger" onClick={p.onDelete}>🗑 Delete</Btn>
      </div>
    </div>
  );
}

function TextInspector(p: Props & { item: TextItem }) {
  const t = p.item;
  const set = (patch: Partial<TextItem>, live = false) => p.apply((tl) => updateText(tl, t.id, patch), { live });
  return (
    <div>
      <Section title="Text">
        <textarea
          value={t.text} rows={3}
          onChange={(e) => set({ text: e.target.value }, true)} onBlur={p.endLive}
          className="w-full resize-none rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
        />
        <div className="grid grid-cols-3 gap-1">
          {(Object.keys(FONTS) as FontId[]).map((f) => (
            <button key={f} type="button" onClick={() => set({ font: f })}
              className={`truncate rounded-md border px-1 py-1.5 text-xs ${t.font === f ? 'border-violet-400 bg-violet-500/10 text-white' : 'border-white/10 bg-zinc-900 text-zinc-300'}`}
              style={{ fontFamily: FONTS[f].family, fontWeight: FONTS[f].weight }}>
              {FONTS[f].label}
            </button>
          ))}
        </div>
        <Slider label="Size" value={t.size} min={24} max={200} step={1} onChange={(size) => set({ size }, true)} onCommit={p.endLive} format={(v) => `${v}px`} />
        <div>
          <div className="mb-1 text-xs text-zinc-400">Text colour</div>
          <ColorRow value={t.color} onChange={(color) => set({ color })} swatches={SWATCHES} />
        </div>
      </Section>
      <Section title="Style">
        <Segmented value={t.style} options={TEXT_STYLES.map((s) => ({ id: s.id, label: s.label }))} onChange={(style) => set({ style })} small />
        {t.style !== 'shadow' && (
          <div>
            <div className="mb-1 text-xs text-zinc-400">{t.style === 'box' ? 'Box' : t.style === 'outline' ? 'Outline' : 'Glow'} colour</div>
            <ColorRow value={t.bg} onChange={(bg) => set({ bg })} swatches={SWATCHES} />
          </div>
        )}
        <div>
          <div className="mb-1 text-xs text-zinc-400">Animation</div>
          <Segmented value={t.anim} options={TEXT_ANIMS.map((a) => ({ id: a.id, label: a.label }))} onChange={(anim) => set({ anim })} small />
        </div>
      </Section>
      <Section title="Placement">
        <div className="grid grid-cols-3 gap-1">
          {[{ l: 'Top', y: 0.18 }, { l: 'Middle', y: 0.45 }, { l: 'Lower', y: 0.62 }].map((o) => (
            <Btn key={o.l} variant="soft" onClick={() => set({ y: o.y, x: 0.5 })}>{o.l}</Btn>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500">Tip: drag the text on the preview to move it.</p>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Start (s)" value={t.start} min={0} onChange={(v) => set({ start: clamp(v, 0, t.end - 0.2) })} />
          <NumberField label="End (s)" value={t.end} min={t.start + 0.2} onChange={(v) => set({ end: Math.max(v, t.start + 0.2) })} />
        </div>
        <Btn variant="soft" className="w-full" onClick={() => set({ end: Math.max(t.start + 0.3, p.layout.total) })}>Show until the end</Btn>
      </Section>
      <div className="flex gap-1 px-4 py-3">
        <Btn variant="soft" onClick={p.onDuplicate}>⧉ Duplicate</Btn>
        <Btn variant="danger" onClick={p.onDelete}>🗑 Delete</Btn>
      </div>
    </div>
  );
}
