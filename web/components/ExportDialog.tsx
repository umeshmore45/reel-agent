'use client';

import { useEffect, useRef, useState } from 'react';
import { cancelRender, downloadUrl, fileUrl, getRender } from '@/lib/api';
import { exportReel } from '@/lib/export';
import type { Project, Render, Timeline } from '@/lib/types';
import { Btn, Segmented, Spinner, Toggle } from './ui';

type Stage =
  | { s: 'setup' }
  | { s: 'overlays' | 'upload' | 'render'; progress: number; renderId?: string }
  | { s: 'done'; render: Render }
  | { s: 'error'; message: string };

export default function ExportDialog({ project, timeline, onClose, onDone }: {
  project: Project; timeline: Timeline; onClose: () => void; onDone: () => void;
}) {
  const [height, setHeight] = useState<1920 | 1280>(1920);
  const [fast, setFast] = useState(false);
  const [music, setMusic] = useState(true);
  const [stage, setStage] = useState<Stage>({ s: 'setup' });
  const live = useRef(true);
  useEffect(() => {
    // Set on mount too: React's dev double-mount runs the cleanup once before the real mount.
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const start = async () => {
    try {
      setStage({ s: 'overlays', progress: 0 });
      const { renderId } = await exportReel(project.id, timeline, project.media, { height, fast, music }, (p) => {
        if (live.current) setStage({ s: p.phase, progress: p.progress });
      });
      setStage({ s: 'render', progress: 0, renderId });
      while (live.current) {
        await new Promise((r) => setTimeout(r, 600));
        const job = await getRender(renderId);
        if (job.status === 'done' && job.render) { setStage({ s: 'done', render: job.render }); onDone(); return; }
        if (job.status !== 'rendering') { setStage({ s: 'error', message: job.error || job.status }); return; }
        setStage({ s: 'render', progress: job.progress, renderId });
      }
    } catch (err) {
      setStage({ s: 'error', message: (err as Error).message });
    }
  };

  const busy = stage.s === 'overlays' || stage.s === 'upload' || stage.s === 'render';
  const labels = { overlays: 'Drawing captions & text', upload: 'Uploading', render: 'Rendering video' };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div className="w-[420px] rounded-2xl border border-white/10 bg-zinc-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-white">Export reel</h2>
        {stage.s === 'setup' && (
          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-1.5 text-xs text-zinc-400">Resolution</div>
              <Segmented value={height} onChange={setHeight} options={[{ id: 1920, label: '1080 × 1920 (Full HD)' }, { id: 1280, label: '720 × 1280 (draft)' }]} />
            </div>
            <div>
              <div className="mb-1.5 text-xs text-zinc-400">Encoding</div>
              <Segmented value={fast ? 'fast' : 'best'} onChange={(v) => setFast(v === 'fast')} options={[{ id: 'best', label: 'Best quality' }, { id: 'fast', label: 'Fast' }]} />
            </div>
            {timeline.music && (
              <div>
                <Toggle label="Include music in the file" checked={music} onChange={setMusic} />
                {!music && (
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-300/80">
                    For Instagram: post this file and add the same song from Instagram&apos;s music library, so the reel isn&apos;t muted for copyright.
                    The cuts stay on the beat.
                  </p>
                )}
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-zinc-500">H.264 + AAC MP4 at 30 fps, ready for Instagram Reels, YouTube Shorts and TikTok.</p>
            <div className="flex justify-end gap-2">
              <Btn onClick={onClose}>Cancel</Btn>
              <Btn variant="primary" onClick={start} disabled={!timeline.clips.length}>Start export</Btn>
            </div>
          </div>
        )}
        {busy && (
          <div className="mt-5">
            <div className="flex items-center gap-2 text-sm text-zinc-200"><Spinner /> {labels[stage.s]}… {Math.round(stage.progress * 100)}%</div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all" style={{ width: `${stage.progress * 100}%` }} />
            </div>
            {stage.s === 'render' && stage.renderId && (
              <div className="mt-4 flex justify-end"><Btn onClick={() => cancelRender(stage.renderId!)}>Cancel render</Btn></div>
            )}
          </div>
        )}
        {stage.s === 'done' && (
          <div className="mt-4 flex gap-4">
            <video src={fileUrl(project.id, stage.render.file)} controls autoPlay className="h-64 rounded-lg bg-black" style={{ aspectRatio: '9/16' }} />
            <div className="flex flex-1 flex-col text-xs text-zinc-400">
              <div className="text-sm font-medium text-emerald-300">✓ Ready</div>
              <div className="mt-1">{stage.render.width}×{stage.render.height}</div>
              <div>{stage.render.duration.toFixed(1)} s · {(stage.render.size / 1024 / 1024).toFixed(1)} MB</div>
              <div>rendered in {stage.render.seconds} s</div>
              <a href={downloadUrl(project.id, stage.render.id)} className="mt-auto rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3 py-2 text-center font-semibold text-white">⬇ Download MP4</a>
              <Btn className="mt-2" onClick={onClose}>Close</Btn>
            </div>
          </div>
        )}
        {stage.s === 'error' && (
          <div className="mt-4">
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-red-500/10 p-3 text-[11px] text-red-300">{stage.message}</pre>
            <div className="mt-3 flex justify-end gap-2"><Btn onClick={onClose}>Close</Btn><Btn variant="soft" onClick={() => setStage({ s: 'setup' })}>Try again</Btn></div>
          </div>
        )}
      </div>
    </div>
  );
}
