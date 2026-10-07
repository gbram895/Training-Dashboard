import { useEffect, useState } from 'react';

// One pulse crossing the mark, matching gd-cadence-travel in index.css.
const CYCLE_MS = 1600;

// Two cycles: long enough for the pulse to cross twice and land. Cutting the
// splash mid-sweep is what reads as a glitch, so the hold is a whole number of
// cycles rather than a round number of milliseconds.
const HOLD_MS = CYCLE_MS * 2;

// Module scope on purpose: the hold belongs to the app launch, not to a
// component. Navigating back to a held screen later in the session resumes
// whatever is left of it rather than starting a fresh 3.2s wait.
let holdStartedAt: number | null = null;

/**
 * True while the launch splash should still be on screen. Returns false
 * immediately for every mount after the first 3.2 seconds of the session.
 */
export default function useSplashHold(): boolean {
  const [holding, setHolding] = useState(() => {
    if (holdStartedAt === null) holdStartedAt = Date.now();
    return Date.now() - holdStartedAt < HOLD_MS;
  });

  useEffect(() => {
    if (!holding) return;
    const remaining = HOLD_MS - (Date.now() - (holdStartedAt ?? Date.now()));
    if (remaining <= 0) {
      setHolding(false);
      return;
    }
    const timer = setTimeout(() => setHolding(false), remaining);
    return () => clearTimeout(timer);
  }, [holding]);

  return holding;
}
