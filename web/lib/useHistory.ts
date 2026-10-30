import { useCallback, useRef, useState } from 'react';

type State<T> = { past: T[]; present: T; future: T[] };

/**
 * Undo/redo for the timeline. `apply(next, { live: true })` updates without a history entry
 * (used while dragging); the next normal apply or `endLive()` records the pre-drag state once.
 */
export function useHistory<T>(initial: T) {
  const [h, setH] = useState<State<T>>({ past: [], present: initial, future: [] });
  const liveBase = useRef<T | null>(null);

  const apply = useCallback((next: T | ((cur: T) => T), opts: { live?: boolean } = {}) => {
    setH((s) => {
      const value = typeof next === 'function' ? (next as (cur: T) => T)(s.present) : next;
      if (value === s.present) return s;
      if (opts.live) {
        if (liveBase.current === null) liveBase.current = s.present;
        return { ...s, present: value };
      }
      const base = liveBase.current ?? s.present;
      liveBase.current = null;
      return { past: [...s.past, base].slice(-100), present: value, future: [] };
    });
  }, []);

  const endLive = useCallback(() => {
    const base = liveBase.current;
    if (base === null) return;
    liveBase.current = null;
    setH((s) => (s.present === base ? s : { past: [...s.past, base].slice(-100), present: s.present, future: [] }));
  }, []);

  const undo = useCallback(() => setH((s) => (s.past.length
    ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] }
    : s)), []);
  const redo = useCallback(() => setH((s) => (s.future.length
    ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) }
    : s)), []);
  const reset = useCallback((value: T) => {
    liveBase.current = null;
    setH({ past: [], present: value, future: [] });
  }, []);

  return { value: h.present, apply, endLive, undo, redo, reset, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
