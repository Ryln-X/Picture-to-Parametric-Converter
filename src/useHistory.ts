import { useCallback, useRef, useState } from 'react';

export function useHistory<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const current = useRef(value), past = useRef<T[]>([]), future = useRef<T[]>([]), transaction = useRef<T | null>(null);
  const [, render] = useState(0);
  const apply = (next: T) => { current.current = next; setValue(next); render(n => n + 1); };
  const set = useCallback((next: T | ((value: T) => T), record = true) => {
    const resolved = typeof next === 'function' ? (next as (value: T) => T)(current.current) : next;
    if (resolved === current.current) return;
    if (record && !transaction.current) { past.current = [...past.current.slice(-59), current.current]; future.current = []; }
    apply(resolved);
  }, []);
  const begin = () => { if (!transaction.current) transaction.current = current.current; };
  const commit = () => {
    if (transaction.current && transaction.current !== current.current) {
      past.current = [...past.current.slice(-59), transaction.current]; future.current = [];
    }
    transaction.current = null; render(n => n + 1);
  };
  const undo = () => {
    if (!past.current.length) return;
    future.current.push(current.current); apply(past.current.pop()!);
  };
  const redo = () => {
    if (!future.current.length) return;
    past.current.push(current.current); apply(future.current.pop()!);
  };
  return { value, set, begin, commit, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0, current };
}
