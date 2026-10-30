import type { ChatMessage, Media, Post, Project, ProjectSummary, Render, Timeline } from './types';

export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100';

export const fileUrl = (projectId: string, rel: string) => `${API}/files/${projectId}/${rel}`;
export const mediaSrc = (projectId: string, m: Media) => fileUrl(projectId, m.proxy || m.file);
export const downloadUrl = (projectId: string, renderId: string) => `${API}/api/projects/${projectId}/renders/${renderId}/download`;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}
const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body ? { 'Content-Type': 'application/json' } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

export const listProjects = () => fetch(`${API}/api/projects`).then((r) => json<ProjectSummary[]>(r));
export const createProject = (name?: string) => fetch(`${API}/api/projects`, send('POST', { name })).then((r) => json<Project>(r));
export const getProject = (id: string) => fetch(`${API}/api/projects/${id}`).then((r) => json<Project>(r));
export const deleteProject = (id: string) => fetch(`${API}/api/projects/${id}`, { method: 'DELETE' });
export const patchProject = (id: string, body: { name?: string; timeline?: Timeline; post?: Post }) =>
  fetch(`${API}/api/projects/${id}`, send('PATCH', body)).then((r) => json<{ ok: true }>(r));

export const deleteMedia = (id: string, mediaId: string) =>
  fetch(`${API}/api/projects/${id}/media/${mediaId}`, { method: 'DELETE' }).then((r) => json<{ timeline: Timeline }>(r));
export const retryTranscript = (id: string, mediaId: string) =>
  fetch(`${API}/api/projects/${id}/media/${mediaId}/transcribe`, { method: 'POST' }).then((r) => json(r));
export const clearChat = (id: string) => fetch(`${API}/api/projects/${id}/chat`, { method: 'DELETE' });
export const deleteRender = (id: string, renderId: string) => fetch(`${API}/api/projects/${id}/renders/${renderId}`, { method: 'DELETE' });

/** Uploads files with progress (fetch can't report upload progress). */
export function uploadMedia(id: string, files: File[], onProgress: (p: number) => void): Promise<Media[]> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/api/projects/${id}/media`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(xhr.responseText || 'Upload failed')));
    xhr.onerror = () => reject(new Error('Upload failed. Is the server running?'));
    xhr.send(form);
  });
}

type AgentHandlers = {
  onActivity: (label: string) => void;
  onDone: (data: { message: ChatMessage; timeline?: Timeline; post?: Post }) => void;
  onError: (message: string) => void;
};

/** Sends a request to the editor agent and reads its SSE stream. */
export async function askAgent(id: string, text: string, timeline: Timeline, h: AgentHandlers, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`${API}/api/projects/${id}/agent`, { ...send('POST', { text, timeline }), signal });
  } catch (err) {
    if ((err as Error).name !== 'AbortError') h.onError('Could not reach the server.');
    return;
  }
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    return h.onError(err.error || res.statusText);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = frame.match(/^event: (.*)$/m)?.[1];
        const data = frame.match(/^data: (.*)$/m)?.[1];
        if (!event || !data) continue;
        const payload = JSON.parse(data);
        if (event === 'activity') h.onActivity(payload.label);
        else if (event === 'done') h.onDone(payload);
        else if (event === 'error') h.onError(payload.message);
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') h.onError('Lost connection to the agent.');
  }
}

export type RenderJob = { id: string; status: 'rendering' | 'done' | 'error' | 'cancelled'; progress: number; error?: string; render?: Render };

export function startRender(id: string, form: FormData, onProgress: (p: number) => void): Promise<{ renderId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/api/projects/${id}/render`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(xhr.responseText || 'Render failed')));
    xhr.onerror = () => reject(new Error('Could not reach the server.'));
    xhr.send(form);
  });
}
export const getRender = (rid: string) => fetch(`${API}/api/renders/${rid}`).then((r) => json<RenderJob>(r));
export const cancelRender = (rid: string) => fetch(`${API}/api/renders/${rid}`, { method: 'DELETE' });
