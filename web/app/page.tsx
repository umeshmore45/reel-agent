'use client';

import { useCallback, useEffect, useState } from 'react';
import Editor from '@/components/Editor';
import { API, createProject, deleteProject, listProjects } from '@/lib/api';
import type { ProjectSummary } from '@/lib/types';

const KEY = 'reel-agent:project';

export default function Home() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    let list = await listProjects();
    if (!list.length) {
      await createProject('My first reel');
      list = await listProjects();
    }
    setProjects(list);
    return list;
  }, []);

  useEffect(() => {
    refresh().then((list) => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
      setCurrent(list.find((p) => p.id === saved)?.id ?? list[0].id);
    }, () => setError(`Can't reach the server at ${API}. Start it with: npm run dev`));
  }, [refresh]);

  useEffect(() => {
    if (!current) return;
    try { localStorage.setItem(KEY, current); } catch { /* private mode */ }
  }, [current]);

  if (error) return <div className="flex h-screen items-center justify-center text-sm text-red-300">{error}</div>;
  if (!current) return <div className="flex h-screen items-center justify-center text-sm text-zinc-500">Loading…</div>;

  return (
    <Editor
      key={current}
      projectId={current}
      projects={projects}
      onSwitch={setCurrent}
      onCreate={async () => {
        const p = await createProject();
        await refresh();
        setCurrent(p.id);
      }}
      onDelete={async (id) => {
        await deleteProject(id);
        const list = await refresh();
        setCurrent(list[0].id);
      }}
      onRenamed={refresh}
    />
  );
}
