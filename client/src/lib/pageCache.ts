import { useState } from 'react';

// Route changes unmount/remount each page, so plain useState always starts
// over — every tab switch re-fetches and shows a "Loading…" flash even for
// data fetched moments ago. This in-memory cache survives across route
// changes (cleared only on a full page reload), so re-visiting a tab renders
// its last-known data immediately while the page's own effect still
// refetches in the background to stay current.
const store = new Map<string, unknown>();

export function useCachedState<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [state, setState] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initialValue));

  function set(value: T) {
    store.set(key, value);
    setState(value);
  }

  return [state, set];
}
