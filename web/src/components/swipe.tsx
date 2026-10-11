import { useRef } from "preact/hooks";
import { directionLock, EDGE_PX, ROW_COMMIT_PX, swipeDecision, type SwipeWay } from "../gesture.js";

/** How far back the flick speed looks. */
const FLICK_WINDOW_MS = 100;
/** A swipe that would change nothing still moves, at a quarter of the finger's travel. */
const RESIST = 0.25;
/** The spring back, the slide away and the collapse; matches the stylesheet. */
const SLIDE_MS = 200;

export interface SwipeActions {
  /** Relevant; absent when that would change nothing. */
  right?: () => void;
  /** Irrelevant and archive; absent when that would change nothing. */
  left?: () => void;
  /** A left swipe collapses the row away, on lists that leave archived issues out. */
  leaves?: boolean;
}

interface Drag {
  pointer: number;
  x: number;
  y: number;
  dx: number;
  lock?: "x" | "y";
  trail: { x: number; t: number }[];
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Swipe on a Browse row (#13, the redesign). Touch only: the Mac rates with keys. After 8 px the
 * drag locks: sideways is the row's, anything else is the list's scroll (`touch-action: pan-y`
 * leaves that to the browser). Past 90 px, or with a flick, it commits: right springs back and
 * the row shows its tag; left slides away and the row collapses. Positions go straight to the DOM,
 * so a drag never re-renders. `onTouch` hears when a press turns into a drag (to clear a pressed
 * state).
 */
export function useSwipe(actions: SwipeActions | undefined, onDrag?: () => void) {
  const row = useRef<HTMLLIElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | undefined>(undefined);
  const swallowUntil = useRef(0);
  const latest = useRef({ actions, onDrag });
  latest.current = { actions, onDrag };

  if (!actions) return { face, rowProps: undefined };

  const place = (dx: number, animate: boolean) => {
    const el = face.current;
    if (!el) return;
    el.style.transition = animate ? "" : "none";
    el.style.transform = dx ? `translateX(${dx}px)` : "";
  };
  const mark = (way: SwipeWay | undefined, armed = false) => {
    const el = row.current;
    if (!el) return;
    if (way) el.dataset.swipe = way;
    else delete el.dataset.swipe;
    el.toggleAttribute("data-armed", armed);
  };
  const springBack = () => {
    place(0, !reducedMotion());
    setTimeout(() => mark(undefined), SLIDE_MS);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    // iOS owns the edges: a swipe from there is Back.
    if (e.clientX < EDGE_PX || e.clientX > innerWidth - EDGE_PX) return;
    drag.current = {
      pointer: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      dx: 0,
      trail: [{ x: e.clientX, t: e.timeStamp }],
    };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    const dx = e.clientX - d.x;
    if (!d.lock) {
      d.lock = directionLock(dx, e.clientY - d.y);
      if (!d.lock) return;
      latest.current.onDrag?.();
      if (d.lock === "y") {
        drag.current = undefined;
        return;
      }
      try {
        row.current?.setPointerCapture(e.pointerId);
      } catch {
        // The pointer is already gone; the drag still ends on pointerup or pointercancel.
      }
    }
    d.dx = dx;
    d.trail = [...d.trail.slice(-4), { x: e.clientX, t: e.timeStamp }];
    const way: SwipeWay = dx > 0 ? "right" : "left";
    const can = Boolean(
      way === "right" ? latest.current.actions?.right : latest.current.actions?.left,
    );
    place(can ? dx : dx * RESIST, false);
    mark(way, can && Math.abs(dx) >= ROW_COMMIT_PX);
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = undefined;
    if (d?.lock !== "x" || e.pointerId !== d.pointer) return;
    // A drag is not a tap: a click that follows must not peek or open.
    swallowUntil.current = performance.now() + 500;
    // Speed over the last 100 ms only: a finger that stopped before letting go is not a flick.
    const end = { x: e.clientX, t: e.timeStamp };
    const first = [...d.trail, end].find((p) => end.t - p.t <= FLICK_WINDOW_MS)!;
    const speed = end.t > first.t ? (end.x - first.x) / (end.t - first.t) : 0;
    const way = swipeDecision(d.dx, ROW_COMMIT_PX, speed);
    const a = latest.current.actions;
    const act = way === "right" ? a?.right : way === "left" ? a?.left : undefined;
    if (!act) {
      springBack();
      return;
    }
    if (way === "left" && a?.leaves) {
      collapse(act);
      return;
    }
    act();
    springBack();
  };

  /** Slide the row away, close the gap, then let the list drop it. */
  const collapse = (act: () => void) => {
    const li = row.current;
    if (!li || reducedMotion()) {
      act();
      return;
    }
    place(-li.offsetWidth, true);
    setTimeout(() => {
      li.style.height = `${li.offsetHeight}px`;
      li.classList.add("collapsing");
      requestAnimationFrame(() => (li.style.height = "0px"));
      setTimeout(() => {
        act();
        // The list drops the row; if it is still here (the change failed), bring it back.
        setTimeout(() => {
          if (!li.isConnected) return;
          li.classList.remove("collapsing");
          li.style.height = "";
          place(0, false);
          mark(undefined);
        }, 400);
      }, SLIDE_MS);
    }, SLIDE_MS);
  };

  const onPointerCancel = () => {
    const was = drag.current?.lock;
    drag.current = undefined;
    if (was === "x") springBack();
  };

  const onClickCapture = (e: MouseEvent) => {
    if (performance.now() > swallowUntil.current) return;
    e.preventDefault();
    e.stopPropagation();
  };

  return {
    face,
    rowProps: {
      ref: row,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
    },
  };
}

/** What shows under a sliding row: Relevant on the left, Irrelevant and archive on the right. */
export function SwipeUnder() {
  return (
    <span class="swipe-under" aria-hidden="true">
      <span class="swipe-rel">✓ Relevant</span>
      <span class="swipe-irr">Irrelevant · archive</span>
    </span>
  );
}
