'use client';

import { useRef, useState } from 'react';
import { deleteMedia, fileUrl, retryTranscript, uploadMedia } from '@/lib/api';
import { fmtTime } from '@/lib/timeline';
import type { Media, Project, Timeline } from '@/lib/types';
import { MEDIA_DRAG_TYPE } from './Timeline';
import { Spinner } from './ui';

type Props = {
  project: Project;
  timeline: Timeline;
  onUploaded: (media: Media[]) => void;
  onRemoved: (mediaId: string, timeline: Timeline) => void;
  onAdd: (m: Media) => void;
  onRefresh: () => void;
};

export default function MediaPanel({ project, timeline, onUploaded, onRemoved, onAdd, onRefresh }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<{ id: number; names: string; progress: number; error?: string }[]>([]);
  const [over, setOver] = useState(false);

  const upload = async (files: File[]) => {
    const ok = files.filter((f) => /^(video|image|audio)\//.test(f.type) || /\.(mov|mp4|m4v|webm|mkv|mp3|m4a|wav|aac|jpe?g|png|webp)$/i.test(f.name));
    if (!ok.length) return;
    const id = Date.now();
    setUploads((u) => [...u, { id, names: ok.map((f) => f.name).join(', '), progress: 0 }]);
    try {
      const media = await uploadMedia(project.id, ok, (progress) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress } : x))));
      setUploads((u) => u.filter((x) => x.id !== id));
      onUploaded(media);
    } catch (err) {
      setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: (err as Error).message } : x)));
    }
  };

  const used = new Set([...timeline.clips.map((c) => c.mediaId), timeline.music?.mediaId]);
  const remove = async (m: Media) => {
    if (used.has(m.id) && !confirm(`"${m.name}" is used in the reel. Remove it and its clips?`)) return;
    const res = await deleteMedia(project.id, m.id);
    onRemoved(m.id, res.timeline);
  };

  return (
    <div className="p-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload([...e.dataTransfer.files]); }}
        className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-3 py-5 text-center transition ${
          over ? 'border-violet-400 bg-violet-500/10' : 'border-white/10 hover:border-white/25 hover:bg-white/[0.02]'}`}
      >
        <span className="text-2xl">⬆</span>
        <span className="mt-1 text-sm font-medium text-zinc-200">Upload footage</span>
        <span className="text-[11px] text-zinc-500">Videos, photos, music · drop files here</span>
      </button>
      <input ref={input} type="file" multiple accept="video/*,image/*,audio/*" className="hidden"
        onChange={(e) => { upload([...(e.target.files || [])]); e.target.value = ''; }} />

      {uploads.map((u) => (
        <div key={u.id} className="mt-2 rounded-lg bg-zinc-900 p-2 text-[11px]">
          <div className="truncate text-zinc-300">{u.names}</div>
          {u.error ? <div className="text-red-300">{u.error}</div> : (
            <div className="mt-1 h-1 overflow-hidden rounded bg-zinc-800">
              <div className="h-full bg-violet-500 transition-all" style={{ width: `${u.progress * 100}%` }} />
            </div>
          )}
        </div>
      ))}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {project.media.map((m) => (
          <div
            key={m.id}
            draggable={m.status === 'ready' && m.kind !== 'audio'}
            onDragStart={(e) => { e.dataTransfer.setData(MEDIA_DRAG_TYPE, m.id); e.dataTransfer.effectAllowed = 'copy'; }}
            className="group relative overflow-hidden rounded-lg border border-white/10 bg-zinc-900"
          >
            <div className="relative aspect-[4/5] bg-zinc-800">
              {m.thumb ? (
                <img src={fileUrl(project.id, m.thumb)} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : (
                <div className="flex h-full items-center justify-center text-3xl text-zinc-600">{m.kind === 'audio' ? '♪' : '▣'}</div>
              )}
              {m.status === 'processing' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[11px] text-zinc-200"><Spinner className="mr-1.5 h-3 w-3" />Processing</div>
              )}
              {m.status === 'ready' && m.kind !== 'image' && (
                <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white">{fmtTime(m.duration)}</span>
              )}
              {used.has(m.id) && <span className="absolute left-1 top-1 rounded bg-violet-500 px-1 text-[9px] font-semibold text-white">IN REEL</span>}
              {m.status === 'ready' && (
                <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition group-hover:opacity-100">
                  <button type="button" onClick={() => onAdd(m)} className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-black">
                    {m.kind === 'audio' ? '♪ Use' : '＋ Add'}
                  </button>
                </div>
              )}
              <button type="button" onClick={() => remove(m)} title="Remove"
                className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded bg-black/70 text-[11px] text-zinc-300 hover:text-red-300 group-hover:flex">
                ✕
              </button>
            </div>
            <div className="px-1.5 py-1">
              <div className="truncate text-[11px] text-zinc-300" title={m.name}>{m.name}</div>
              <div className="truncate text-[10px] text-zinc-500">{status(m)}</div>
              {m.transcript.status === 'error' && (
                <button type="button" className="text-[10px] text-violet-300" onClick={async () => { await retryTranscript(project.id, m.id); onRefresh(); }}>
                  Retry transcript
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {!project.media.length && !uploads.length && (
        <p className="mt-4 text-center text-xs leading-relaxed text-zinc-500">
          Add your raw clips, a few photos and a song. The agent watches them, transcribes the speech and cuts the reel for you.
        </p>
      )}
    </div>
  );
}

function status(m: Media) {
  if (m.status === 'error') return `⚠ ${m.error || 'Failed'}`;
  if (m.status === 'processing') return 'Analysing…';
  if (m.kind === 'audio') return m.bpm ? `Music · ${Math.round(m.bpm)} BPM` : 'Audio';
  if (m.kind === 'image') return `Photo · ${m.width}×${m.height}`;
  if (m.transcript.status === 'pending') return 'Transcribing speech…';
  if (m.transcript.status === 'done' && m.transcript.quality === 'low') return 'Speech unclear (noise / not English)';
  if (m.transcript.status === 'done') return m.transcript.words.length ? `✓ ${m.transcript.words.length} words` : 'No speech';
  if (m.transcript.status === 'error') return '⚠ Transcript failed';
  return m.hasAudio ? 'Video' : 'Video · no sound';
}
