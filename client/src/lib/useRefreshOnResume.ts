import { useEffect, useRef } from 'react';

// Pages fetch their data once, on mount. That is fine in a browser tab, but an
// installed PWA is almost never remounted — it gets resumed from the app
// switcher hours later and re-renders the values it was backgrounded with,
// which is why new workouts could sit on the server while the dashboard still
// showed yesterday's. Refetching whenever the app becomes visible again makes
// reopening it enough to see current data.
//
// Throttled, because iOS fires visibilitychange and focus together on resume,
// and a quick app-switch away and back shouldn't re-run every request.
const MIN_INTERVAL_MS = 30_000;

export function useRefreshOnResume(refresh: () => void) {
  // Held in a ref so callers don't have to memoise their loader for the
  // listener to stay registered across renders. Assigned in an effect rather
  // than during render, so a render that never commits can't swap it.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    // Seeded with "now": the page has just mounted and fetched, so a focus
    // event arriving moments later is not a reason to fetch it all again.
    let lastRefresh = Date.now();

    function refreshIfStale() {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefresh < MIN_INTERVAL_MS) return;
      lastRefresh = Date.now();
      refreshRef.current();
    }

    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    return () => {
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.removeEventListener('focus', refreshIfStale);
    };
  }, []);
}
