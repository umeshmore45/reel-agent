'use client';

import { useEffect, useRef, useState } from 'react';
import { askAgent, clearChat } from '@/lib/api';
import type { ChatMessage, Post, Project, Timeline } from '@/lib/types';
import { Spinner } from './ui';

const QUICK = [
  { label: '🎬 Auto-edit a viral reel', text: 'Watch all my footage and edit a 20-30 second viral reel: strong hook in the first 2 seconds, tight cuts, captions, a hook text and a call to action. Use the music if there is any.' },
  { label: '🪝 Stronger hook', text: 'Make the first 2 seconds a much stronger hook: open on the most striking moment and add a bold hook text.' },
  { label: '✂ Cut silences & fillers', text: 'Remove every pause, filler word and mistake from the talking parts so it feels tight.' },
  { label: '⚡ Faster pacing', text: 'Make it faster paced and more energetic: shorter shots, cut on the beat.' },
  { label: '♫ Sync to the beat', text: 'Re-cut so every cut lands on the beat of the music.' },
  { label: '🎨 Cinematic look', text: 'Give the whole reel a consistent cinematic colour grade and smooth motion on still shots.' },
  { label: '#️⃣ Caption & hashtags', text: 'Write an Instagram caption and hashtags for this reel.' },
];

type Props = {
  project: Project;
  timeline: Timeline;
  onApply: (timeline: Timeline) => void;
  onPost: (post: Post) => void;
  onChat: (chat: ChatMessage[]) => void;
  pendingPrompt: string | null;
  onPendingUsed: () => void;
  onUndo: () => void;
};

export default function AgentChat({ project, timeline, onApply, onPost, onChat, pendingPrompt, onPendingUsed, onUndo }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(0);
  const [, tick] = useState(0);
  const [lastApplied, setLastApplied] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const chatRef = useRef(project.chat);
  chatRef.current = project.chat;

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [project.chat.length, steps.length, busy]);
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const send = async (msg: string) => {
    const q = msg.trim();
    if (!q || busy) return;
    setText('');
    setError('');
    setSteps([]);
    setBusy(true);
    setStarted(Date.now());
    const userMsg: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content: q, createdAt: new Date().toISOString() };
    onChat([...chatRef.current, userMsg]);
    abort.current = new AbortController();
    await askAgent(project.id, q, timelineRef.current, {
      onActivity: (label) => setSteps((s) => (s[s.length - 1] === label ? s : [...s, label])),
      onDone: ({ message, timeline: tl, post }) => {
        onChat([...chatRef.current, message]);
        if (tl) { onApply(tl); setLastApplied(message.id); }
        if (post) onPost(post);
      },
      onError: (m) => setError(m),
    }, abort.current.signal);
    setBusy(false);
  };

  useEffect(() => {
    if (pendingPrompt) { send(pendingPrompt); onPendingUsed(); }
  }, [pendingPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  const processing = project.media.filter((m) => m.status === 'processing' || m.transcript.status === 'pending').length;
  const hasMedia = project.media.some((m) => m.status === 'ready');

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {!project.chat.length && (
          <div className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 p-4">
            <div className="text-sm font-semibold text-white">Your AI editor</div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              It watches your clips, reads the transcript, and cuts a reel: hook, pacing, captions, text, music, colour.
              Then keep chatting to refine it. Every edit can be undone.
            </p>
          </div>
        )}
        {project.chat.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
              m.role === 'user' ? 'rounded-br-md bg-violet-600 text-white' : 'rounded-bl-md bg-zinc-800 text-zinc-100'}`}>
              {m.content}
              {m.applied && (
                <div className="mt-1.5 flex items-center gap-2 border-t border-white/10 pt-1.5 text-[11px] text-emerald-300">
                  ✓ Edit applied
                  {lastApplied === m.id && <button type="button" onClick={() => { onUndo(); setLastApplied(null); }} className="text-zinc-400 underline hover:text-white">Undo</button>}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="rounded-2xl rounded-bl-md bg-zinc-800/70 px-3 py-2 text-xs text-zinc-300">
            <div className="flex items-center gap-2 font-medium text-zinc-100">
              <Spinner /> Editing… <span className="font-mono text-zinc-500">{Math.round((Date.now() - started) / 1000)}s</span>
              <button type="button" onClick={() => abort.current?.abort()} className="ml-auto text-zinc-500 hover:text-red-300">Stop</button>
            </div>
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-zinc-400">
              {steps.slice(-6).map((s, i) => <li key={i} className="truncate">• {s}</li>)}
            </ul>
          </div>
        )}
        {error && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
        <div ref={bottom} />
      </div>

      <div className="border-t border-white/5 p-3">
        {processing > 0 && <p className="mb-2 text-[11px] text-amber-300/80">{processing} file{processing > 1 ? 's are' : ' is'} still being analysed. The agent can only use ready media.</p>}
        <div className="mb-2 flex flex-wrap gap-1">
          {QUICK.map((q) => (
            <button key={q.label} type="button" disabled={busy || !hasMedia} onClick={() => send(q.text)}
              className="rounded-full border border-white/10 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-violet-400/60 hover:text-white disabled:opacity-40">
              {q.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-zinc-900 p-1.5 focus-within:border-violet-500">
          <textarea
            value={text} rows={2} disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
            placeholder={hasMedia ? 'e.g. "Make a 15s travel reel, warm look, start with the beach shot"' : 'Upload some footage first…'}
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          <button type="button" disabled={busy || !text.trim()} onClick={() => send(text)}
            className="rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
            Send
          </button>
        </div>
        {project.chat.length > 0 && (
          <button type="button" disabled={busy} className="mt-1.5 text-[10px] text-zinc-600 hover:text-zinc-400"
            onClick={async () => { await clearChat(project.id); onChat([]); }}>
            New conversation
          </button>
        )}
      </div>
    </div>
  );
}
