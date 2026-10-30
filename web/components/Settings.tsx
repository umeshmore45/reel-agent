'use client';

import { CAPTION_STYLES, SWATCHES } from '@/lib/constants';
import { FONTS } from '@/lib/fonts';
import { playhead } from '@/lib/playhead';
import { fmtTime, snapCutsToBeats, type CaptionPage } from '@/lib/timeline';
import type { CaptionStyleId, Captions, Look, Media, Music, Timeline } from '@/lib/types';
import { Btn, ColorRow, Section, Segmented, Slider, Toggle } from './ui';

type Apply = (fn: (tl: Timeline) => Timeline, opts?: { live?: boolean }) => void;

export function CaptionsSettings({ timeline, pages, media, apply, endLive }: {
  timeline: Timeline; pages: CaptionPage[]; media: Media[]; apply: Apply; endLive: () => void;
}) {
  const c = timeline.captions;
  const set = (patch: Partial<Captions>, live = false) => apply((tl) => ({ ...tl, captions: { ...tl.captions, ...patch } }), { live });
  const pending = media.filter((m) => m.kind === 'video' && m.transcript.status === 'pending').length;

  const editPage = (page: CaptionPage, text: string) => {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    const overrides = { ...c.overrides };
    page.words.forEach((w, i) => {
      overrides[w.key] = i === page.words.length - 1 ? tokens.slice(i).join(' ') : tokens[i] ?? '';
    });
    set({ overrides });
  };

  return (
    <>
      <Section title="Auto captions" right={<Toggle label="" checked={c.enabled} onChange={(enabled) => set({ enabled })} />}>
        {pending > 0 && <p className="text-xs text-amber-300/80">Transcribing {pending} clip{pending > 1 ? 's' : ''}… captions appear when done.</p>}
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(CAPTION_STYLES) as CaptionStyleId[]).map((id) => {
            const st = CAPTION_STYLES[id];
            return (
              <button
                key={id} type="button" onClick={() => set({ style: id })}
                className={`rounded-lg border px-1 py-2.5 text-center text-[13px] leading-none ${
                  c.style === id ? 'border-violet-400 bg-violet-500/10' : 'border-white/10 bg-zinc-900 hover:border-white/25'}`}
                style={{ fontFamily: FONTS[st.font].family, fontWeight: st.weight }}
              >
                <span style={{ color: st.color, WebkitTextStroke: st.stroke ? `0.6px ${st.stroke}` : undefined }}>A</span>
                <span className="mx-0.5 rounded px-0.5" style={{ color: st.activeBg ? '#fff' : st.active, background: st.activeBg, textShadow: st.glow ? `0 0 6px ${st.glow}` : undefined }}>B</span>
                <div className="mt-1.5 font-sans text-[10px] font-normal text-zinc-400">{st.label}</div>
              </button>
            );
          })}
        </div>
        <Slider label="Position" value={c.y} min={0.1} max={0.9} onChange={(y) => set({ y }, true)} onCommit={endLive} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Size" value={c.size} min={40} max={130} step={1} onChange={(size) => set({ size }, true)} onCommit={endLive} format={(v) => `${v}px`} />
        <div>
          <div className="mb-1 text-xs text-zinc-400">Words per caption</div>
          <Segmented value={c.wordsPerPage} options={[1, 2, 3, 4, 5].map((n) => ({ id: n, label: n }))} onChange={(wordsPerPage) => set({ wordsPerPage })} small />
        </div>
        <Toggle label="UPPERCASE" checked={c.uppercase} onChange={(uppercase) => set({ uppercase })} />
        <div>
          <div className="mb-1 flex justify-between text-xs text-zinc-400">
            <span>Highlight colour</span>
            {c.highlight && <button type="button" className="text-violet-300" onClick={() => set({ highlight: '' })}>Style default</button>}
          </div>
          <ColorRow value={c.highlight || CAPTION_STYLES[c.style].activeBg || CAPTION_STYLES[c.style].active} onChange={(highlight) => set({ highlight })} swatches={SWATCHES} />
        </div>
      </Section>
      <Section title={`Edit captions (${pages.length})`}>
        {!pages.length && <p className="text-xs text-zinc-500">No speech on the timeline yet.</p>}
        <div className="space-y-1">
          {pages.map((pg) => (
            <div key={`${pg.id}-${pg.words[0].key}`} className="flex items-center gap-2">
              <button type="button" onClick={() => playhead.set(pg.start + 0.01)} className="w-10 shrink-0 text-left font-mono text-[10px] text-zinc-500 hover:text-violet-300">
                {fmtTime(pg.start)}
              </button>
              <input
                defaultValue={pg.words.map((w) => w.text).join(' ')}
                onBlur={(e) => e.target.value !== pg.words.map((w) => w.text).join(' ') && editPage(pg, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                className="min-w-0 flex-1 rounded border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-violet-500"
              />
            </div>
          ))}
        </div>
        {Object.keys(c.overrides).length > 0 && (
          <Btn variant="ghost" onClick={() => set({ overrides: {} })}>Reset caption edits</Btn>
        )}
      </Section>
    </>
  );
}

export function MusicSettings({ timeline, media, mediaMap, apply, endLive }: {
  timeline: Timeline; media: Media[]; mediaMap: Map<string, Media>; apply: Apply; endLive: () => void;
}) {
  const music = timeline.music;
  const tracks = media.filter((m) => m.kind === 'audio');
  const current = music ? mediaMap.get(music.mediaId) : undefined;
  const set = (patch: Partial<Music>, live = false) => apply((tl) => (tl.music ? { ...tl, music: { ...tl.music, ...patch } } : tl), { live });
  const choose = (m: Media | null) => apply((tl) => ({
    ...tl,
    music: m ? { mediaId: m.id, volume: 0.6, start: m.highlight ?? 0, fadeIn: 0.5, fadeOut: 1, duck: true, duckLevel: 0.3, ...(tl.music?.mediaId === m.id ? tl.music : {}) } : null,
  }));

  return (
    <>
      <Section title="Music track">
        {!tracks.length && <p className="text-xs text-zinc-500">Upload an MP3/M4A/WAV in the Media tab to use it as music.</p>}
        <div className="space-y-1">
          {tracks.map((m) => (
            <button
              key={m.id} type="button" disabled={m.status !== 'ready'} onClick={() => choose(music?.mediaId === m.id ? null : m)}
              className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs ${
                music?.mediaId === m.id ? 'border-emerald-400 bg-emerald-500/10 text-emerald-100' : 'border-white/10 bg-zinc-900 text-zinc-300 hover:border-white/25'}`}
            >
              <span>{music?.mediaId === m.id ? '●' : '○'}</span>
              <span className="flex-1 truncate">{m.name}</span>
              <span className="text-zinc-500">{m.status === 'ready' ? `${fmtTime(m.duration)}${m.bpm ? ` · ${Math.round(m.bpm)} BPM` : ''}` : 'processing…'}</span>
            </button>
          ))}
        </div>
      </Section>
      {music && current && (
        <Section title="Mix">
          <Slider label="Music volume" value={music.volume} min={0} max={1} onChange={(volume) => set({ volume }, true)} onCommit={endLive} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Song starts at" value={music.start} min={0} max={Math.max(1, current.duration - 1)} step={0.05}
            onChange={(start) => set({ start }, true)} onCommit={endLive} format={(v) => fmtTime(v, true)} />
          {current.highlight !== undefined && (
            <Btn variant="soft" onClick={() => set({ start: current.highlight! })}>Jump to strongest part ({fmtTime(current.highlight)})</Btn>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Slider label="Fade in" value={music.fadeIn} min={0} max={5} step={0.1} onChange={(fadeIn) => set({ fadeIn }, true)} onCommit={endLive} format={(v) => `${v.toFixed(1)}s`} />
            <Slider label="Fade out" value={music.fadeOut} min={0} max={5} step={0.1} onChange={(fadeOut) => set({ fadeOut }, true)} onCommit={endLive} format={(v) => `${v.toFixed(1)}s`} />
          </div>
          <Toggle label="Auto-duck under speech" checked={music.duck} onChange={(duck) => set({ duck })} />
          {music.duck && (
            <Slider label="Music level while talking" value={music.duckLevel} min={0.05} max={1} onChange={(duckLevel) => set({ duckLevel }, true)} onCommit={endLive} format={(v) => `${Math.round(v * 100)}%`} />
          )}
          {current.beats?.length ? (
            <Btn variant="soft" onClick={() => apply((tl) => snapCutsToBeats(tl, mediaMap))}>♫ Snap cuts to the beat</Btn>
          ) : null}
        </Section>
      )}
    </>
  );
}

export function LookSettings({ timeline, apply, endLive }: { timeline: Timeline; apply: Apply; endLive: () => void }) {
  const look = timeline.look ?? { letterbox: 0, vignette: 0, fade: false };
  const set = (patch: Partial<Look>, live = false) => apply((tl) => ({ ...tl, look: { ...look, ...tl.look, ...patch } }), { live });
  return (
    <>
      <Section title="Presets">
        <div className="grid grid-cols-2 gap-1.5">
          <Btn variant="soft" onClick={() => set({ letterbox: 0.1, vignette: 0.45, fade: true })}>🎬 Cinematic</Btn>
          <Btn variant="soft" onClick={() => set({ letterbox: 0, vignette: 0.25, fade: true })}>✨ Soft</Btn>
          <Btn variant="soft" onClick={() => set({ letterbox: 0.14, vignette: 0.7, fade: true })}>🌑 Dramatic</Btn>
          <Btn variant="soft" onClick={() => set({ letterbox: 0, vignette: 0, fade: false })}>Clean</Btn>
        </div>
        <p className="text-[11px] text-zinc-500">The colour of each clip is set per clip in the Inspector.</p>
      </Section>
      <Section title="Finish">
        <Slider label="Cinema bars" value={look.letterbox} min={0} max={0.2} step={0.005} onChange={(letterbox) => set({ letterbox }, true)} onCommit={endLive} format={(v) => (v ? `${Math.round(v * 100)}%` : 'Off')} />
        <Slider label="Vignette" value={look.vignette} min={0} max={1} onChange={(vignette) => set({ vignette }, true)} onCommit={endLive} format={(v) => (v ? `${Math.round(v * 100)}%` : 'Off')} />
        <Toggle label="Fade in & out from black" checked={look.fade} onChange={(fade) => set({ fade })} />
      </Section>
    </>
  );
}
