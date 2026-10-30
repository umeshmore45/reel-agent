import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { emptyTimeline } from './timeline.js';

export const PROJECTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace', 'projects');
const SUBDIRS = ['media', 'proxy', 'thumbs', 'sheets', 'audio', 'renders'];

// Each project lives in its own folder (workspace/projects/<id>/project.json + its media),
// which is also the agent's working directory so it can Read the contact sheets.
const cache = new Map();
const writes = new Map();

export const projectDir = (id) => path.join(PROJECTS_DIR, id);
export const getProject = (id) => cache.get(id);
const now = () => new Date().toISOString();

export async function loadProjects() {
  await mkdir(PROJECTS_DIR, { recursive: true });
  for (const id of await readdir(PROJECTS_DIR)) {
    try {
      const project = JSON.parse(await readFile(path.join(projectDir(id), 'project.json'), 'utf8'));
      // Anything that was mid-processing when the server stopped is retried by the caller.
      cache.set(project.id, project);
    } catch { /* not a project folder */ }
  }
  return [...cache.values()];
}

export function listProjects() {
  return [...cache.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(summary);
}

export function summary(p) {
  const thumb = p.media.find((m) => m.thumb)?.thumb;
  return { id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, thumb: thumb || null, mediaCount: p.media.length };
}

export async function createProject(name) {
  const project = {
    id: randomUUID(),
    name: name?.trim().slice(0, 80) || 'Untitled reel',
    createdAt: now(),
    updatedAt: now(),
    media: [],
    timeline: emptyTimeline(),
    chat: [],
    claudeSessionId: randomUUID(),
    agentStarted: false,
    agentSeenMedia: [],
    post: { caption: '', hashtags: [] },
    renders: [],
  };
  for (const sub of SUBDIRS) await mkdir(path.join(projectDir(project.id), sub), { recursive: true });
  cache.set(project.id, project);
  await saveProject(project);
  return project;
}

/** Writes project.json atomically; writes for the same project are queued so they never interleave. */
export function saveProject(project, { touch = true } = {}) {
  if (touch) project.updatedAt = now();
  const file = path.join(projectDir(project.id), 'project.json');
  const prev = writes.get(project.id) || Promise.resolve();
  const next = prev.then(async () => {
    if (!cache.has(project.id)) return;
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(project, null, 1));
    await rename(tmp, file);
  }).catch((err) => console.error(`[store] could not save ${project.id}: ${err.message}`));
  writes.set(project.id, next);
  return next;
}

export async function deleteProject(id) {
  cache.delete(id);
  await writes.get(id);
  writes.delete(id);
  await rm(projectDir(id), { recursive: true, force: true });
}
