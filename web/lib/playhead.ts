import { useEffect, useState } from 'react';

type Listener = (t: number, fromPlayback: boolean) => void;

// The playhead changes every frame while playing; keeping it outside React state means only
// the few things that show it (playhead line, time readout) update, not the whole editor.
let time = 0;
const listeners = new Set<Listener>();

export const playhead = {
  get: () => time,
  set(t: number, fromPlayback = false) {
    time = Math.max(0, t);
    listeners.forEach((l) => l(time, fromPlayback));
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};

/** Playhead time as React state, at most `fps` updates per second (plus the final value). */
export function usePlayheadTime(fps = 12) {
  const [t, setT] = useState(time);
  useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = playhead.subscribe((v) => {
      clearTimeout(timer);
      const now = performance.now();
      if (now - last > 1000 / fps) {
        last = now;
        setT(v);
      } else {
        timer = setTimeout(() => setT(playhead.get()), 1000 / fps);
      }
    });
    return () => { unsub(); clearTimeout(timer); };
  }, [fps]);
  return t;
}
