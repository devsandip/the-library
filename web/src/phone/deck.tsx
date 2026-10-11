import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import {
  CARD_COMMIT_PX,
  cardTransform,
  directionLock,
  EDGE_PX,
  labelOpacity,
  swipeDecision,
  TAP_PX,
  type SwipeWay,
} from "../gesture.js";
import { reducedMotion } from "../components/swipe.js";

/** The fly-out and the spring back. */
const MOTION_MS = 250;
/** Under reduced motion, cards cross-fade instead. */
const FADE_MS = 120;
const FLICK_WINDOW_MS = 100;

/**
 * Today's top card under the finger (the redesign, 1c-1). It follows the finger, turning about
 * its bottom edge, with no transition while dragging; the swipe labels fade in with the distance.
 * Let go past 100 px (or with a flick) and it flies out, then the action applies and the next card
 * shows with no transition. Under that, it springs back. Less than 6 px of movement is a tap.
 * Drags that start on a button, or within 20 px of the screen's edges, are not the card's.
 */
export function SwipeCard({
  labels,
  onSwipe,
  onTap,
  class: cls = "",
  children,
}: {
  /** The words that show as the card leans each way. */
  labels: { right: string; left: string };
  onSwipe: (way: SwipeWay) => void;
  onTap?: () => void;
  class?: string;
  children: ComponentChildren;
}) {
  const card = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLSpanElement>(null);
  const left = useRef<HTMLSpanElement>(null);
  const drag = useRef<
    | {
        pointer: number;
        x: number;
        y: number;
        dx: number;
        lock?: "x" | "y";
        trail: { x: number; t: number }[];
      }
    | undefined
  >(undefined);
  const leaving = useRef(false);

  const show = (dx: number, transition: string) => {
    const el = card.current;
    if (!el) return;
    el.style.transition = transition;
    el.style.transform = dx ? cardTransform(dx) : "";
    if (right.current) right.current.style.opacity = String(dx > 0 ? labelOpacity(dx) : 0);
    if (left.current) left.current.style.opacity = String(dx < 0 ? labelOpacity(dx) : 0);
  };

  const leave = (way: SwipeWay) => {
    const el = card.current;
    if (!el || leaving.current) return;
    leaving.current = true;
    if (reducedMotion()) {
      el.style.transition = `opacity ${FADE_MS}ms ease-in`;
      el.style.opacity = "0";
      setTimeout(() => onSwipe(way), FADE_MS);
      return;
    }
    const sign = way === "right" ? 1 : -1;
    el.style.transition = `transform ${MOTION_MS}ms ease-in`;
    el.style.transform = `translateX(${sign * 520}px) rotate(${sign * 18}deg)`;
    setTimeout(() => onSwipe(way), MOTION_MS);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!e.isPrimary || leaving.current) return;
    if ((e.target as Element | null)?.closest("button, a")) return;
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
      if (d.lock === "y") {
        drag.current = undefined;
        return;
      }
      try {
        card.current?.setPointerCapture(e.pointerId);
      } catch {
        // Already gone; pointerup or pointercancel still ends the drag.
      }
    }
    d.dx = dx;
    d.trail = [...d.trail.slice(-4), { x: e.clientX, t: e.timeStamp }];
    show(reducedMotion() ? 0 : dx, "none");
    if (reducedMotion()) {
      if (right.current) right.current.style.opacity = String(dx > 0 ? labelOpacity(dx) : 0);
      if (left.current) left.current.style.opacity = String(dx < 0 ? labelOpacity(dx) : 0);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = undefined;
    if (!d || e.pointerId !== d.pointer) return;
    if (!d.lock || Math.abs(d.dx) < TAP_PX) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < TAP_PX) onTap?.();
      return;
    }
    if (d.lock !== "x") return;
    const end = { x: e.clientX, t: e.timeStamp };
    const first = [...d.trail, end].find((p) => end.t - p.t <= FLICK_WINDOW_MS)!;
    const speed = end.t > first.t ? (end.x - first.x) / (end.t - first.t) : 0;
    const way = swipeDecision(d.dx, CARD_COMMIT_PX, speed);
    if (way) leave(way);
    else show(0, `transform ${MOTION_MS}ms cubic-bezier(.2,.8,.2,1)`);
  };

  const onPointerCancel = () => {
    if (drag.current?.lock === "x") show(0, `transform ${MOTION_MS}ms cubic-bezier(.2,.8,.2,1)`);
    drag.current = undefined;
  };

  return (
    <div
      ref={card}
      class={`card top ${cls}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <span ref={right} class="card-flag right" aria-hidden="true">
        {labels.right}
      </span>
      <span ref={left} class="card-flag left" aria-hidden="true">
        {labels.left}
      </span>
      {children}
    </div>
  );
}
