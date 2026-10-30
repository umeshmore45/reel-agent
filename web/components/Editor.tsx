'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getProject, patchProject } from '@/lib/api';
import { loadFonts } from '@/lib/fonts';
import { playhead } from '@/lib/playhead';
import {
  captionPages, layoutClips, newClip, newText, reelWords, removeSilences, speechRegions, splitAt, uid, updateText,
} from '@/lib/timeline';
import { useHistory } from '@/lib/useHistory';
import type { ChatMessage, Media, Post, Project, ProjectSummary, Selection, Timeline as TL } from '@/lib/types';
import AgentChat from './AgentChat';
import ExportDialog from './ExportDialog';
import Inspector from './Inspector';
import MediaPanel from './MediaPanel';
import Preview, { type DragTarget } from './Preview';
import PublishPanel from './PublishPanel';
import { CaptionsSettings, LookSettings, MusicSettings } from './Settings';
import Timeline from './Timeline';
import { Btn } from './ui';

const EMPTY: TL = {
  clips: [], texts: [], music: null,
  captions: { enabled: true, style: 'pop', y: 0.68, size: 76, wordsPerPage: 3, uppercase: true, highlight: '', overrides: {} },
  look: { letterbox: 0, vignette: 0, fade: false },
};
type LeftTab = 'media' | 'captions' | 'music' | 'look' | 'publish';

type Props = {
  projectId: string;
  projects: ProjectSummary[];
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRenamed: () => void;
};

export default function Editor({ projectId, projects, onSwitch, onCreate, onDelete, onRenamed }: Props) {
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState('');
  const hist = useHistory<TL>(EMPTY);
  const timeline = hist.value;
  const { apply, endLive } = hist;
  const [selection, setSelection] = useState<Selection>(null);
  const [playing, setPlaying] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>('media');
  const [rightTab, setRightTab] = useState<'agent' | 'inspector'>('agent');
  const [exporting, setExporting] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [toast, setToast] = useState('');
  const [saved, setSaved] = useState<'saved' | 'saving' | 'error'>('saved');
  const loaded = useRef(false);

  useEffect(() => {
    playhead.set(0);
    getProject(projectId).then((p) => {
      setProject(p);
      hist.reset(p.timeline);
      loaded.current = true;
    }, (err) => setLoadError(err.message));
    loadFonts().then(() => setFontsReady(true));
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    const p = await getProject(projectId);
    setProject((cur) => (cur ? { ...cur, media: p.media, renders: p.renders } : p));
  }, [projectId]);

  // Poll while uploads are being analysed (thumbnails, transcripts, proxies).
  const busyMedia = project?.media.some((m) => m.status === 'processing' || m.transcript.status === 'pending' || m.proxyPending);
  useEffect(() => {
    if (!busyMedia) return;
    const id = setInterval(() => refresh().catch(() => {}), 2000);
    return () => clearInterval(id);
  }, [busyMedia, refresh]);

  // Autosave the timeline.
  useEffect(() => {
    if (!loaded.current) return;
    setSaved('saving');
    const id = setTimeout(() => {
      patchProject(projectId, { timeline }).then(() => setSaved('saved'), () => setSaved('error'));
    }, 700);
    return () => clearTimeout(id);
  }, [timeline, projectId]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const media = useMemo(() => project?.media ?? [], [project?.media]);
  const mediaMap = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const layout = useMemo(() => layoutClips(timeline.clips.filter((c) => mediaMap.get(c.mediaId)?.status === 'ready')), [timeline.clips, mediaMap]);
  const words = useMemo(() => reelWords(timeline, layout, mediaMap), [timeline, layout, mediaMap]);
  // fontsReady is a dependency so the preview redraws captions once the web fonts load.
  const pages = useMemo(() => captionPages(words, timeline.captions.wordsPerPage), [words, timeline.captions.wordsPerPage, fontsReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const regions = useMemo(() => speechRegions(words), [words]);

  const select = useCallback((s: Selection) => {
    setSelection(s);
    if (s) setRightTab('inspector');
  }, []);

  const togglePlay = useCallback(() => {
    if (!layout.items.length) return;
    setPlaying((p) => !p);
  }, [layout.items.length]);

  const split = () => {
    const r = splitAt(timeline, layout, playhead.get());
    if (r) { apply(r.tl); select({ kind: 'clip', id: r.id }); } else setToast('Move the playhead inside a clip to split it');
  };

  const del = () => {
    const s = selection;
    if (!s) return;
    if (s.kind === 'clip') apply((tl) => ({ ...tl, clips: tl.clips.filter((c) => c.id !== s.id) }));
    if (s.kind === 'text') apply((tl) => ({ ...tl, texts: tl.texts.filter((t) => t.id !== s.id) }));
    if (s.kind === 'captions') apply((tl) => ({ ...tl, captions: { ...tl.captions, enabled: false } }));
    if (s.kind === 'music') apply((tl) => ({ ...tl, music: null }));
    setSelection(null);
  };

  const duplicate = () => {
    const s = selection;
    if (s?.kind === 'clip') {
      const id = uid('c');
      apply((tl) => {
        const i = tl.clips.findIndex((c) => c.id === s.id);
        const clips = [...tl.clips];
        clips.splice(i + 1, 0, { ...tl.clips[i], id });
        return { ...tl, clips };
      });
      select({ kind: 'clip', id });
    } else if (s?.kind === 'text') {
      const t = timeline.texts.find((x) => x.id === s.id);
      if (!t) return;
      const copy = { ...t, id: uid('t'), start: t.end, end: t.end + (t.end - t.start) };
      apply((tl) => ({ ...tl, texts: [...tl.texts, copy] }));
      select({ kind: 'text', id: copy.id });
    }
  };

  const addText = () => {
    const t = newText(Math.min(playhead.get(), Math.max(0, layout.total - 0.5)));
    apply((tl) => ({ ...tl, texts: [...tl.texts, t] }));
    select({ kind: 'text', id: t.id });
  };

  const insertMedia = (m: Media, index?: number) => {
    if (m.status !== 'ready') return;
    if (m.kind === 'audio') {
      apply((tl) => ({ ...tl, music: { mediaId: m.id, volume: 0.6, start: m.highlight ?? 0, fadeIn: 0.5, fadeOut: 1, duck: true, duckLevel: 0.3 } }));
      select({ kind: 'music' });
      return;
    }
    const clip = newClip(m);
    apply((tl) => {
      const clips = [...tl.clips];
      const after = selection?.kind === 'clip' ? clips.findIndex((c) => c.id === selection.id) : -1;
      clips.splice(index ?? (after >= 0 ? after + 1 : clips.length), 0, clip);
      return { ...tl, clips };
    });
    select({ kind: 'clip', id: clip.id });
  };

  const onOverlayDrag = (target: DragTarget, x: number, y: number, live: boolean) => {
    if (!live) return endLive();
    if (target.kind === 'text') apply((tl) => updateText(tl, target.id, { x, y }), { live: true });
    else apply((tl) => ({ ...tl, captions: { ...tl.captions, y } }), { live: true });
  };

  const onRemoveSilences = (clipId: string) => {
    const c = timeline.clips.find((x) => x.id === clipId);
    const m = c && mediaMap.get(c.mediaId);
    if (!m) return;
    const r = removeSilences(timeline, clipId, m);
    if (r.removed < 0.05) return setToast('No pauses or filler words to remove');
    apply(r.tl);
    setToast(`Removed ${r.removed.toFixed(1)} s of silence and filler`);
  };

  const setPost = (post: Post) => {
    setProject((p) => (p ? { ...p, post } : p));
    patchProject(projectId, { post }).catch(() => {});
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) hist.redo(); else hist.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); hist.redo(); return; }
      if (mod || e.altKey) return;
      if (k === 's') split();
      else if (k === 't') addText();
      else if (k === 'd') duplicate();
      else if (k === 'backspace' || k === 'delete') { e.preventDefault(); del(); }
      else if (k === 'escape') setSelection(null);
      else if (k === 'arrowleft' || k === 'arrowright') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / 30;
        playhead.set(Math.min(layout.total, playhead.get() + (k === 'arrowleft' ? -step : step)));
      } else if (k === 'home') playhead.set(0);
      else if (k === 'end') playhead.set(layout.total);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (loadError) return <div className="flex h-screen items-center justify-center text-sm text-red-300">{loadError}</div>;
  if (!project) return <div className="flex h-screen items-center justify-center text-sm text-zinc-500">Loading project…</div>;

  const tabs: { id: LeftTab; label: string }[] = [
    { id: 'media', label: 'Media' }, { id: 'captions', label: 'Captions' }, { id: 'music', label: 'Music' }, { id: 'look', label: 'Look' }, { id: 'publish', label: 'Publish' },
  ];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#09090b] text-zinc-200">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-4">
        <div className="flex items-center gap-2 font-semibold text-white">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm">✦</span>
          Reel Agent <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">PRO</span>
        </div>
        <div className="mx-2 h-5 w-px bg-white/10" />
        <input
          key={project.id + project.name} defaultValue={project.name}
          onBlur={async (e) => {
            const name = e.target.value.trim();
            if (name && name !== project.name) { await patchProject(project.id, { name }); setProject({ ...project, name }); onRenamed(); }
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-48 rounded-md bg-transparent px-2 py-1 text-sm text-zinc-100 outline-none hover:bg-white/5 focus:bg-white/10"
        />
        <select
          value={project.id} onChange={(e) => (e.target.value === '__new' ? onCreate() : onSwitch(e.target.value))}
          className="rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none"
        >
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="__new">＋ New project</option>
        </select>
        <Btn variant="danger" title="Delete this project" onClick={() => confirm(`Delete "${project.name}" and all its media?`) && onDelete(project.id)}>🗑</Btn>
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-2 text-[11px] text-zinc-500">{saved === 'saving' ? 'Saving…' : saved === 'error' ? '⚠ Not saved' : '✓ Saved'}</span>
          <Btn onClick={hist.undo} disabled={!hist.canUndo} title="Undo (⌘Z)">↶ Undo</Btn>
          <Btn onClick={hist.redo} disabled={!hist.canRedo} title="Redo (⇧⌘Z)">↷ Redo</Btn>
          <Btn variant="primary" className="ml-2 px-4" onClick={() => { setPlaying(false); setExporting(true); }} disabled={!layout.items.length}>⬇ Export</Btn>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-white/10 bg-zinc-950/60">
          <div className="flex border-b border-white/10 px-2">
            {tabs.map((t) => (
              <button key={t.id} type="button" onClick={() => setLeftTab(t.id)}
                className={`flex-1 border-b-2 py-2.5 text-xs font-medium ${leftTab === t.id ? 'border-violet-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {leftTab === 'media' && (
              <MediaPanel
                project={project} timeline={timeline} onAdd={insertMedia} onRefresh={refresh}
                onUploaded={(m) => setProject((p) => (p ? { ...p, media: [...p.media, ...m] } : p))}
                onRemoved={(id, tl) => { setProject((p) => (p ? { ...p, media: p.media.filter((m) => m.id !== id) } : p)); hist.reset(tl); setSelection(null); }}
              />
            )}
            {leftTab === 'captions' && <CaptionsSettings timeline={timeline} pages={pages} media={media} apply={apply} endLive={endLive} />}
            {leftTab === 'music' && <MusicSettings timeline={timeline} media={media} mediaMap={mediaMap} apply={apply} endLive={endLive} />}
            {leftTab === 'look' && <LookSettings timeline={timeline} apply={apply} endLive={endLive} />}
            {leftTab === 'publish' && (
              <PublishPanel project={project} onPost={setPost} onExport={() => setExporting(true)} onRendersChange={refresh}
                onAsk={(text) => { setRightTab('agent'); setPendingPrompt(text); }} />
            )}
          </div>
        </aside>

        <main className="relative min-w-0 flex-1 p-4">
          <Preview
            project={project} timeline={timeline} layout={layout} pages={pages} regions={regions} mediaMap={mediaMap}
            playing={playing} onEnded={() => setPlaying(false)} selection={selection} onSelect={select} onOverlayDrag={onOverlayDrag}
          />
          {toast && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-zinc-800 px-4 py-2 text-xs text-white shadow-xl ring-1 ring-white/10">{toast}</div>
          )}
        </main>

        <aside className="flex w-[360px] shrink-0 flex-col border-l border-white/10 bg-zinc-950/60">
          <div className="flex border-b border-white/10 px-2">
            {(['agent', 'inspector'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setRightTab(t)}
                className={`flex-1 border-b-2 py-2.5 text-xs font-medium ${rightTab === t ? 'border-fuchsia-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
                {t === 'agent' ? '✦ AI Agent' : 'Inspector'}
              </button>
            ))}
          </div>
          <div className={`min-h-0 flex-1 ${rightTab === 'agent' ? '' : 'hidden'}`}>
            <AgentChat
              project={project} timeline={timeline}
              onApply={(tl) => { apply(tl); setSelection(null); playhead.set(0); }}
              onPost={(post) => setProject((p) => (p ? { ...p, post } : p))}
              onChat={(chat: ChatMessage[]) => setProject((p) => (p ? { ...p, chat } : p))}
              pendingPrompt={pendingPrompt} onPendingUsed={() => setPendingPrompt(null)} onUndo={hist.undo}
            />
          </div>
          <div className={`min-h-0 flex-1 overflow-y-auto ${rightTab === 'inspector' ? '' : 'hidden'}`}>
            <Inspector
              projectId={project.id} timeline={timeline} layout={layout} pages={pages} media={media} mediaMap={mediaMap}
              selection={selection} apply={apply} endLive={endLive}
              onSplit={split} onDuplicate={duplicate} onDelete={del} onRemoveSilences={onRemoveSilences}
            />
          </div>
        </aside>
      </div>

      <div className="h-[270px] shrink-0">
        <Timeline
          projectId={project.id} timeline={timeline} layout={layout} pages={pages} mediaMap={mediaMap}
          selection={selection} onSelect={select} apply={apply} endLive={endLive}
          playing={playing} onTogglePlay={togglePlay} onSplit={split} onDelete={del} onDuplicate={duplicate} onAddText={addText}
          onDropMedia={(id, index) => { const m = mediaMap.get(id); if (m) insertMedia(m, index); }}
        />
      </div>

      {exporting && (
        <ExportDialog project={project} timeline={timeline} onClose={() => setExporting(false)} onDone={refresh} />
      )}
    </div>
  );
}
