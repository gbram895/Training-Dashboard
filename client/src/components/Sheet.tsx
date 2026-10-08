import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject, type ReactNode } from 'react';

/**
 * The app's modal sheet. On a phone it sits on the bottom edge and behaves
 * like an iOS sheet: it follows your finger down from wherever you grabbed it,
 * and on release it either closes or springs back depending on where the
 * flick was heading, not just where your finger stopped. Closing in any way
 * (swipe, tapping the dimmed area, Escape, a Cancel button) slides it back
 * down the edge it came up from. On wider screens it is a centred card that
 * fades in and out. The entrance itself is CSS (`@starting-style` on
 * .modal-card); this component owns the drag and the exit.
 */

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_DRAWER = 'cubic-bezier(0.32, 0.72, 0, 1)';

// The drawer curve leaves at roughly 2.25x its average speed, so a duration of
// 2.25 x distance / velocity starts the exit at the finger's own speed.
const DRAWER_INITIAL_SLOPE = 0.72 / 0.32;

/** Where a flick would come to rest: the exponential decay iOS uses for scroll. */
function project(velocityPxPerSec: number, decelerationRate = 0.998): number {
  return ((velocityPxPerSec / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Past a boundary, follow the finger less and less instead of stopping dead. */
function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isBottomSheet(): boolean {
  return window.matchMedia('(max-width: 639px)').matches;
}

/** Closes the sheet with its exit animation, then runs `after` (default: onClose). */
export type SheetDismiss = (after?: () => void) => void;

export default function Sheet({
  onClose,
  className,
  dismissRef,
  children,
}: {
  onClose: () => void;
  className?: string;
  /** Filled with this sheet's dismiss, so a Cancel or Save inside can close it the same way a swipe does. */
  dismissRef?: MutableRefObject<SheetDismiss | null>;
  children: ReactNode;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  // `velocity` (px/s) and `from` (px already travelled) let a swipe hand its
  // speed to the exit, so there's no seam between dragging and animating.
  const close = useCallback((after?: () => void, velocity = 0, from = 0) => {
    if (closingRef.current) return;
    closingRef.current = true;
    const done = () => (after ?? onCloseRef.current)();
    const overlay = overlayRef.current;
    const card = cardRef.current;
    if (!overlay || !card) return done();

    let duration = 200;
    if (prefersReducedMotion()) {
      card.style.transition = `opacity ${duration}ms ${EASE_OUT}`;
      card.style.opacity = '0';
    } else if (isBottomSheet()) {
      const remaining = card.offsetHeight - from;
      duration =
        velocity > 0 ? Math.min(300, Math.max(120, ((DRAWER_INITIAL_SLOPE * remaining) / velocity) * 1000)) : 260;
      card.style.transition = `transform ${duration}ms ${EASE_DRAWER}`;
      card.style.transform = 'translateY(100%)';
    } else {
      duration = 150;
      card.style.transition = `transform ${duration}ms ${EASE_OUT}, opacity ${duration}ms ${EASE_OUT}`;
      card.style.transform = 'scale(0.96)';
      card.style.opacity = '0';
    }
    overlay.style.transition = `opacity ${duration}ms ${EASE_OUT}`;
    overlay.style.opacity = '0';
    window.setTimeout(done, duration);
  }, []);

  const dismiss = useCallback<SheetDismiss>((after) => close(after), [close]);
  useLayoutEffect(() => {
    if (dismissRef) dismissRef.current = dismiss;
  }, [dismissRef, dismiss]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') dismiss();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  // Swipe down to close. Touch events rather than pointer events: the sheet's
  // own content has to keep scrolling natively, and only a non-passive
  // touchmove can claim a downward pull at the top of that scroll for the
  // sheet instead.
  useEffect(() => {
    const card = cardRef.current;
    const overlay = overlayRef.current;
    if (!card || !overlay) return;

    let start: { x: number; y: number } | null = null;
    let dragging = false;
    let height = 0;
    let offset = 0;
    let samples: { y: number; t: number }[] = [];

    function onStart(e: TouchEvent) {
      start = null;
      dragging = false;
      if (closingRef.current || !isBottomSheet() || e.touches.length !== 1) return;
      const target = e.target as Element | null;
      // Controls that track the finger themselves keep it.
      if (target?.closest('[data-sheet-no-drag], input[type="range"], textarea, select')) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      samples = [{ y: t.clientY, t: e.timeStamp }];
    }

    function onMove(e: TouchEvent) {
      if (!start || !card || !overlay) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!dragging) {
        // Only a downward pull while the content is scrolled to the top
        // belongs to the sheet; anything else is a normal scroll.
        if (card.scrollTop > 0 || dy < 0 || Math.abs(dx) > Math.abs(dy)) {
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) start = null;
          return;
        }
        if (e.cancelable) e.preventDefault();
        if (dy < 4) return;
        dragging = true;
        height = card.offsetHeight;
        card.style.transition = 'none';
        overlay.style.transition = 'none';
      }
      if (e.cancelable) e.preventDefault();
      // 1:1 with the finger from where it first touched, and resisting if
      // pushed back above the resting position.
      offset = dy >= 0 ? dy : -rubberband(-dy, height);
      card.style.transform = `translateY(${offset}px)`;
      overlay.style.opacity = String(Math.max(0, 1 - Math.max(0, offset) / height));
      samples.push({ y: t.clientY, t: e.timeStamp });
      while (samples.length > 2 && e.timeStamp - samples[0].t > 100) samples.shift();
    }

    function onEnd(e: TouchEvent) {
      if (!dragging || !card || !overlay) {
        start = null;
        return;
      }
      dragging = false;
      start = null;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const elapsed = Math.max(1, (last?.t ?? e.timeStamp) - (first?.t ?? e.timeStamp));
      const velocity = first && last ? ((last.y - first.y) / elapsed) * 1000 : 0; // px/s, down is positive

      // Decide on where the gesture was going, not where it stopped. A tall
      // sheet shouldn't need a longer throw than a short one, so the bar is
      // half the sheet up to 240px.
      if (offset + project(velocity) > Math.min(height / 2, 240)) {
        close(undefined, velocity, offset);
        return;
      }
      card.style.transition = `transform 300ms ${EASE_DRAWER}`;
      card.style.transform = 'translateY(0)';
      overlay.style.transition = `opacity 300ms ${EASE_OUT}`;
      overlay.style.opacity = '1';
    }

    card.addEventListener('touchstart', onStart, { passive: true });
    card.addEventListener('touchmove', onMove, { passive: false });
    card.addEventListener('touchend', onEnd);
    card.addEventListener('touchcancel', onEnd);
    return () => {
      card.removeEventListener('touchstart', onStart);
      card.removeEventListener('touchmove', onMove);
      card.removeEventListener('touchend', onEnd);
      card.removeEventListener('touchcancel', onEnd);
    };
  }, [close]);

  return (
    <div className="modal-overlay" ref={overlayRef} onClick={() => dismiss()}>
      <div
        className={`modal-card card${className ? ` ${className}` : ''}`}
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gd-sheet-grabber" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
