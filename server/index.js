import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  PROJECTS_DIR, createProject, deleteProject, getProject, listProjects, loadProjects, projectDir, saveProject,
} from './lib/store.js';
import { kindFromUpload, queueMedia, queueSheetRefresh, retranscribe } from './lib/media.js';
import { SHEET_VERSION } from './lib/ffmpeg.js';
import { sanitizeTimeline } from './lib/timeline.js';
import { cleanup, renderReel } from './lib/render.js';
import { runAgent } from './agent/claudeCli.js';
import { buildTurnPrompt } from './agent/prompt.js';

const PORT = process.env.PORT || 4100;
// Local only: the API serves your footage and runs Claude Code on your account.
const HOST = process.env.HOST || '127.0.0.1';
const WEB_ORIGINS = (process.env.WEB_ORIGIN || 'http://localhost:3100,http://127.0.0.1:3100').split(',');
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const app = express();
// Rejects requests through any other hostname, so a web page can't reach the API via DNS rebinding.
app.use((req, res, next) => (LOCAL_HOSTNAMES.has(req.hostname) ? next() : res.status(403).json({ error: 'Forbidden host' })));
// Only the editor may call the API from a browser.
app.use(cors({ origin: WEB_ORIGINS }));
app.use(express.json({ limit: '5mb' }));
// Media, thumbnails, proxies and renders. express.static handles Range requests for video seeking.
app.use('/files', express.static(PROJECTS_DIR, { dotfiles: 'deny', index: false }));

const now = () => new Date().toISOString();

// Resume work interrupted by a restart.
for (const project of await loadProjects()) {
  for (const m of project.media) {
    if (m.status === 'processing' || m.transcript?.status === 'pending' || (m.kind === 'video' && m.status === 'ready' && !m.proxy)) {
      m.status = 'processing';
      queueMedia(project, m);
    } else if (m.kind === 'video' && m.status === 'ready' && m.sheet && (m.sheetVersion || 1) < SHEET_VERSION) {
      queueSheetRefresh(project, m);
    }
  }
}

function withProject(req, res, next) {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  req.project = project;
  next();
}

const publicProject = ({ claudeSessionId, agentStarted, agentSeenMedia, ...p }) => p;

// ---------- projects ----------

app.get('/api/projects', (req, res) => res.json(listProjects()));

app.post('/api/projects', async (req, res) => {
  const project = await createProject(req.body?.name);
  res.status(201).json(publicProject(project));
});

app.get('/api/projects/:id', withProject, (req, res) => res.json(publicProject(req.project)));

app.patch('/api/projects/:id', withProject, async (req, res) => {
  const p = req.project;
  const { name, timeline, post } = req.body || {};
  if (typeof name === 'string' && name.trim()) p.name = name.trim().slice(0, 80);
  if (timeline) p.timeline = sanitizeTimeline(timeline, p.media, p.timeline);
  if (post && typeof post === 'object') {
    p.post = {
      caption: String(post.caption ?? p.post.caption).slice(0, 2200),
      hashtags: (Array.isArray(post.hashtags) ? post.hashtags : p.post.hashtags).map(String).slice(0, 30),
    };
  }
  await saveProject(p);
  res.json({ ok: true, updatedAt: p.updatedAt, timeline: timeline ? p.timeline : undefined });
});

app.delete('/api/projects/:id', withProject, async (req, res) => {
  await deleteProject(req.project.id);
  res.status(204).end();
});

// ---------- media ----------

const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(projectDir(req.project.id), 'media')),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      file.mediaId = `m${randomUUID().slice(0, 8)}`;
      cb(null, `${file.mediaId}${/^\.[a-z0-9]{1,5}$/.test(ext) ? ext : ''}`);
    },
  }),
  limits: { fileSize: 4 * 1024 ** 3, files: 50 },
});

app.post('/api/projects/:id/media', withProject, mediaUpload.array('files', 50), async (req, res) => {
  const p = req.project;
  const added = (req.files || []).map((f) => ({
    id: f.mediaId,
    kind: kindFromUpload(f.mimetype, f.originalname),
    name: f.originalname.slice(0, 120),
    file: `media/${f.filename}`,
    size: f.size,
    duration: 0,
    width: 0,
    height: 0,
    hasAudio: false,
    status: 'processing',
    transcript: { status: 'none', words: [], text: '' },
    createdAt: now(),
  }));
  p.media.push(...added);
  await saveProject(p);
  added.forEach((m) => queueMedia(p, m));
  res.status(201).json(added);
});

app.delete('/api/projects/:id/media/:mediaId', withProject, async (req, res) => {
  const p = req.project;
  const m = p.media.find((x) => x.id === req.params.mediaId);
  if (!m) return res.status(404).json({ error: 'Media not found' });
  p.media = p.media.filter((x) => x !== m);
  p.timeline = sanitizeTimeline(p.timeline, p.media, p.timeline);
  await saveProject(p);
  const dir = projectDir(p.id);
  await Promise.all([m.file, m.thumb, m.sheet, m.proxy].filter(Boolean).map((f) => rm(path.join(dir, f), { force: true })));
  res.json({ timeline: p.timeline });
});

app.post('/api/projects/:id/media/:mediaId/transcribe', withProject, async (req, res) => {
  const m = req.project.media.find((x) => x.id === req.params.mediaId);
  if (!m || m.kind !== 'video' || !m.hasAudio) return res.status(400).json({ error: 'Not a video with sound' });
  m.transcript = { status: 'pending', words: [], text: '' };
  await saveProject(req.project, { touch: false });
  retranscribe(req.project, m).catch(() => {});
  res.json({ ok: true });
});

// ---------- agent ----------

const agentBusy = new Set();

app.post('/api/projects/:id/agent', withProject, async (req, res) => {
  const p = req.project;
  const text = String(req.body?.text || '').trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (agentBusy.has(p.id)) return res.status(409).json({ error: 'The agent is already working on this project' });
  agentBusy.add(p.id);

  // The browser sends its latest timeline so the agent edits exactly what the user sees.
  if (req.body.timeline) p.timeline = sanitizeTimeline(req.body.timeline, p.media, p.timeline);
  p.chat.push({ id: randomUUID(), role: 'user', content: text, createdAt: now() });
  await saveProject(p);

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const names = new Map(p.media.map((m) => [m.id, m.name]));
  const prompt = buildTurnPrompt({ text, project: p, timeline: p.timeline });
  const sentMedia = p.media.filter((m) => m.transcript?.status === 'done').map((m) => m.id);

  let done = false;
  const start = (resume) => runAgent({
    prompt,
    sessionId: p.claudeSessionId,
    resume,
    cwd: projectDir(p.id),
    onActivity: (a) => {
      if (a.type === 'read') {
        const id = path.basename(a.file).replace(/\.\w+$/, '');
        send('activity', { label: `Watching ${names.get(id) || path.basename(a.file)}` });
      } else send('activity', { label: a.text });
    },
    onDone: async (out) => {
      done = true;
      p.agentStarted = true;
      p.agentSeenMedia = [...new Set([...(p.agentSeenMedia || []), ...sentMedia])];
      let timeline;
      if (out.timeline && Array.isArray(out.timeline.clips)) {
        timeline = sanitizeTimeline({ captions: p.timeline.captions, ...out.timeline }, p.media, p.timeline);
        p.timeline = timeline;
      }
      if (out.post && (out.post.caption || out.post.hashtags?.length)) {
        p.post = {
          caption: String(out.post.caption || '').slice(0, 2200),
          hashtags: (out.post.hashtags || []).map((h) => `#${String(h).replace(/^#+/, '').replace(/\s+/g, '')}`).filter((h) => h.length > 1).slice(0, 30),
        };
      }
      const message = { id: randomUUID(), role: 'assistant', content: String(out.reply || 'Done.'), createdAt: now(), applied: Boolean(timeline) };
      p.chat.push(message);
      await saveProject(p);
      agentBusy.delete(p.id);
      send('done', { message, timeline, post: out.post ? p.post : undefined });
      res.end();
    },
    onError: async (msg) => {
      // A deleted/expired CLI session: start a fresh one and retry once.
      if (resume && /no conversation found/i.test(msg)) {
        p.claudeSessionId = randomUUID();
        p.agentSeenMedia = [];
        kill = start(false);
        return;
      }
      done = true;
      agentBusy.delete(p.id);
      send('error', { message: msg });
      res.end();
    },
  });
  let kill = start(Boolean(p.agentStarted));
  send('activity', { label: 'Reading your footage' });

  res.on('close', () => {
    if (!done) {
      kill();
      agentBusy.delete(p.id);
    }
  });
});

app.delete('/api/projects/:id/chat', withProject, async (req, res) => {
  const p = req.project;
  p.chat = [];
  p.claudeSessionId = randomUUID();
  p.agentStarted = false;
  p.agentSeenMedia = [];
  await saveProject(p);
  res.status(204).end();
});

// ---------- render ----------

const jobs = new Map();

async function prepRender(req, res, next) {
  req.renderId = `r${randomUUID().slice(0, 8)}`;
  req.workDir = path.join(projectDir(req.project.id), 'renders', req.renderId);
  await mkdir(req.workDir, { recursive: true });
  next();
}

const overlayUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, req.workDir),
    filename: (req, file, cb) => cb(null, file.originalname),
  }),
  fileFilter: (req, file, cb) => cb(null, /^(ov_\d{1,5}|blank)\.(png|webp)$/.test(file.originalname)),
  limits: { fileSize: 20 * 1024 ** 2, files: 6000, fieldSize: 20 * 1024 ** 2 },
});

app.post('/api/projects/:id/render', withProject, prepRender, overlayUpload.array('overlays', 6000), async (req, res) => {
  const p = req.project;
  let meta;
  try { meta = JSON.parse(req.body.meta || '{}'); } catch { meta = {}; }
  const uploaded = new Set((req.files || []).map((f) => f.originalname));
  const overlays = (Array.isArray(meta.overlays) ? meta.overlays : [])
    .filter((o) => uploaded.has(o.file) && Number(o.duration) > 0)
    .map((o) => ({ file: o.file, duration: Number(o.duration) }));
  const duckRegions = (Array.isArray(meta.duckRegions) ? meta.duckRegions : []).slice(0, 400)
    .map((r) => ({ start: Number(r.start), end: Number(r.end) }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);
  const timeline = sanitizeTimeline(meta.timeline || p.timeline, p.media, p.timeline);
  const height = meta.height === 1280 ? 1280 : 1920;

  const id = req.renderId;
  const outFile = path.join(projectDir(p.id), 'renders', `${id}.mp4`);
  const controller = new AbortController();
  const job = { id, projectId: p.id, status: 'rendering', progress: 0, controller, startedAt: Date.now() };
  jobs.set(id, job);
  res.status(202).json({ renderId: id });

  try {
    const info = await renderReel({
      project: p, timeline, height, fast: Boolean(meta.fast), overlays, duckRegions,
      workDir: req.workDir, outFile: `${outFile}.part.mp4`, signal: controller.signal,
      onProgress: (x) => { job.progress = x; },
    });
    await rename(`${outFile}.part.mp4`, outFile);
    const render = { id, file: `renders/${id}.mp4`, createdAt: now(), ...info, seconds: Math.round((Date.now() - job.startedAt) / 1000) };
    p.renders.unshift(render);
    await saveProject(p);
    Object.assign(job, { status: 'done', progress: 1, render });
    await cleanup(req.workDir);
  } catch (err) {
    Object.assign(job, { status: controller.signal.aborted ? 'cancelled' : 'error', error: err.message });
    console.error(`[render ${id}] ${err.message}\n  graph: ${path.join(req.workDir, 'graph.txt')}`);
    await rm(`${outFile}.part.mp4`, { force: true });
  }
});

app.get('/api/renders/:rid', (req, res) => {
  const job = jobs.get(req.params.rid);
  if (!job) return res.status(404).json({ error: 'Render not found' });
  const { controller, ...pub } = job;
  res.json(pub);
});

app.delete('/api/renders/:rid', (req, res) => {
  jobs.get(req.params.rid)?.controller.abort();
  res.status(204).end();
});

app.get('/api/projects/:id/renders/:rid/download', withProject, (req, res) => {
  const r = req.project.renders.find((x) => x.id === req.params.rid);
  if (!r) return res.status(404).json({ error: 'Render not found' });
  const name = `${req.project.name.replace(/[^\w\- ]+/g, '').trim() || 'reel'}.mp4`;
  res.download(path.join(projectDir(req.project.id), r.file), name);
});

app.delete('/api/projects/:id/renders/:rid', withProject, async (req, res) => {
  const p = req.project;
  const r = p.renders.find((x) => x.id === req.params.rid);
  if (r) {
    p.renders = p.renders.filter((x) => x !== r);
    await saveProject(p, { touch: false });
    await rm(path.join(projectDir(p.id), r.file), { force: true });
  }
  res.status(204).end();
});

app.listen(PORT, HOST, () => console.log(`Reel agent server on http://${HOST}:${PORT}`));
