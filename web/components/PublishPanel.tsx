'use client';

import { useState } from 'react';
import { deleteRender, downloadUrl, fileUrl } from '@/lib/api';
import type { Post, Project } from '@/lib/types';
import { Btn, Section } from './ui';

type Props = {
  project: Project;
  onPost: (post: Post) => void;
  onAsk: (text: string) => void;
  onExport: () => void;
  onRendersChange: () => void;
};

export default function PublishPanel({ project, onPost, onAsk, onExport, onRendersChange }: Props) {
  const { post } = project;
  const [copied, setCopied] = useState(false);
  const full = [post.caption, post.hashtags.join(' ')].filter(Boolean).join('\n\n');

  return (
    <>
      <Section title="Post caption" right={
        <button type="button" className="text-[11px] text-violet-300" onClick={() => onAsk('Write a scroll-stopping Instagram caption and hashtags for this reel.')}>
          ✨ Write with agent
        </button>
      }>
        <textarea
          key={`c-${project.updatedAt}`}
          defaultValue={post.caption} rows={6} placeholder="Caption for Instagram / Shorts…"
          onBlur={(e) => e.target.value !== post.caption && onPost({ ...post, caption: e.target.value })}
          className="w-full resize-none rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-xs leading-relaxed text-zinc-100 outline-none focus:border-violet-500"
        />
        <textarea
          key={`h-${project.updatedAt}`}
          defaultValue={post.hashtags.join(' ')} rows={2} placeholder="#reels #travel"
          onBlur={(e) => onPost({ ...post, hashtags: e.target.value.split(/[\s,]+/).filter(Boolean).map((h) => (h.startsWith('#') ? h : `#${h}`)) })}
          className="w-full resize-none rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-xs text-sky-300 outline-none focus:border-violet-500"
        />
        <Btn variant="soft" disabled={!full} onClick={() => {
          navigator.clipboard.writeText(full).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
        }}>
          {copied ? '✓ Copied' : '⧉ Copy caption + hashtags'}
        </Btn>
      </Section>
      <Section title="Exports">
        <Btn variant="primary" className="w-full py-2" onClick={onExport}>⬇ Export MP4</Btn>
        {!project.renders.length && <p className="text-xs text-zinc-500">Finished reels show up here.</p>}
        {project.renders.map((r) => (
          <div key={r.id} className="flex gap-2 rounded-lg border border-white/10 bg-zinc-900 p-2">
            <video src={fileUrl(project.id, r.file)} className="h-24 w-[54px] shrink-0 rounded bg-black object-cover" muted preload="metadata" />
            <div className="min-w-0 flex-1 text-[11px] text-zinc-400">
              <div className="text-zinc-200">{r.width}×{r.height} · {r.duration.toFixed(1)} s</div>
              <div>{(r.size / 1024 / 1024).toFixed(1)} MB · {new Date(r.createdAt).toLocaleString()}</div>
              <div className="mt-1.5 flex gap-1">
                <a href={downloadUrl(project.id, r.id)} className="rounded-md bg-violet-500 px-2 py-1 font-medium text-white hover:bg-violet-400">Download</a>
                <a href={fileUrl(project.id, r.file)} target="_blank" rel="noreferrer" className="rounded-md bg-zinc-800 px-2 py-1 text-zinc-200 hover:bg-zinc-700">Play</a>
                <button type="button" className="rounded-md px-2 py-1 text-red-300 hover:bg-red-500/10"
                  onClick={async () => { await deleteRender(project.id, r.id); onRendersChange(); }}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}
