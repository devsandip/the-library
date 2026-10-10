import { useRef, useState } from "preact/hooks";
import type { IssueListItem } from "@library/core/types";
import { useApp } from "../context.js";
import {
  COMMIT_SHARE,
  swipeChange,
  swipeDecision,
  type SwipeChange,
  type SwipeWay,
} from "../gesture.js";
import { useLibrary } from "../library.js";
import { ThumbDown, ThumbUp } from "./icons.js";

/** Sideways travel before a row follows the finger; anything shorter is a tap. */
const ENGAGE_PX = 10;
/** How far back the flick speed looks. */
const FLICK_WINDOW_MS = 100;
/** A swipe that would change nothing still moves, at a quarter of the finger's travel. */
const RESIST = 0.25;
/** The slide back or away; matches `.swipe-face`'s transition in the CSS. */
const SLIDE_MS = 180;
/** How long "Archived. Undo" stays up. */
const UNDO_MS = 5000;

export interface SwipeActions {
  /** Rate Relevant; absent when that would change nothing. */
  right?: () => void;
  /** Rate Irrelevant and archive; absent when that would change nothing. */
  left?: () => void;
  /** A left swipe slides the row away, on lists that leave archived issues out. */
  leaves?: boolean;
}

interface Drag {
  pointer: number;
  x: number;
  y: number;
  dx: number;
  engaged: boolean;
  /** The last few positions, for the flick speed. */
  trail: { x: number; t: number }[];
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Swipe to rate on one row (#13). Touch only: on the Mac, rating stays on the issue page. The row
 * follows the finger once it moves more sideways than down; `touch-action: pan-y` on `.swipe`
 * leaves vertical scrolling to the browser. Positions go straight to the DOM, so a drag never
 * re-renders.
 */
export function useSwipe(actions: SwipeActions | undefined) {
  const row = useRef<HTMLLIElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | undefined>(undefined);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const swallowUntil = useRef(0);
  const latest = useRef(actions);
  latest.current = actions;

  if (!actions) return { face, rowProps: undefined };

  const place = (dx: number, animate: boolean) => {
    const el = face.current;
    if (!el) return;
    el.style.transition = animate ? "" : "none";
    el.style.transform = dx ? `translateX(${dx}px)` : "";
  };
  /** Which side shows under the row, whether letting go would commit, and whether it can. */
  const mark = (way: SwipeWay | undefined, armed = false, off = false) => {
    const el = row.current;
    if (!el) return;
    if (way) el.dataset.swipe = way;
    else delete el.dataset.swipe;
    el.toggleAttribute("data-armed", armed);
    el.toggleAttribute("data-off", off);
  };
  const springBack = () => {
    place(0, !reducedMotion());
    clearTimeout(settle.current);
    settle.current = setTimeout(() => mark(undefined), SLIDE_MS);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    clearTimeout(settle.current);
    drag.current = {
      pointer: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      dx: 0,
      engaged: false,
      trail: [{ x: e.clientX, t: e.timeStamp }],
    };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.engaged) {
      // More down than sideways: a scroll, which is the browser's.
      if (Math.abs(dy) > ENGAGE_PX && Math.abs(dy) >= Math.abs(dx)) {
        drag.current = undefined;
        return;
      }
      if (Math.abs(dx) <= ENGAGE_PX || Math.abs(dx) <= Math.abs(dy)) return;
      d.engaged = true;
      try {
        row.current?.setPointerCapture(e.pointerId);
      } catch {
        // The pointer is already gone; the drag still ends on pointerup or pointercancel.
      }
    }
    d.dx = dx;
    d.trail = [...d.trail.slice(-4), { x: e.clientX, t: e.timeStamp }];
    const way: SwipeWay = dx > 0 ? "right" : "left";
    const can = Boolean(way === "right" ? latest.current?.right : latest.current?.left);
    const width = row.current?.offsetWidth ?? 1;
    place(can ? dx : dx * RESIST, false);
    mark(way, can && Math.abs(dx) >= COMMIT_SHARE * width, !can);
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = undefined;
    if (!d?.engaged || e.pointerId !== d.pointer) return;
    // A drag is not a tap: a click that follows must not open the issue.
    swallowUntil.current = performance.now() + 500;
    // Speed over the last 100ms only: a finger that stopped before letting go is not a flick.
    const end = { x: e.clientX, t: e.timeStamp };
    const first = [...d.trail, end].find((p) => end.t - p.t <= FLICK_WINDOW_MS)!;
    const speed = end.t > first.t ? (end.x - first.x) / (end.t - first.t) : 0;
    const width = row.current?.offsetWidth ?? 1;
    const way = swipeDecision(d.dx, width, speed);
    const act =
      way === "right" ? latest.current?.right : way === "left" ? latest.current?.left : undefined;
    if (!act) {
      springBack();
      return;
    }
    if (way === "left" && latest.current?.leaves && !reducedMotion()) {
      place(-width, true);
      setTimeout(() => {
        act();
        // The list drops the row; if it is still here (the save failed), bring it back.
        setTimeout(() => {
          if (!face.current?.isConnected) return;
          place(0, false);
          mark(undefined);
        }, 400);
      }, SLIDE_MS);
      return;
    }
    act();
    springBack();
  };

  const onPointerCancel = () => {
    const engaged = drag.current?.engaged;
    drag.current = undefined;
    if (engaged) springBack();
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

/** What shows under a sliding row: Relevant on the left, Irrelevant on the right. */
export function SwipeUnder() {
  return (
    <span class="swipe-under" aria-hidden="true">
      <span class="swipe-up">
        <ThumbUp filled />
      </span>
      <span class="swipe-down">
        <ThumbDown filled />
      </span>
    </span>
  );
}

/**
 * What swipes do on a list (#13): right rates Relevant; left rates Irrelevant and archives, with
 * "Archived. Undo" for a few seconds. With `hide`, an archived row leaves the list (Home, the
 * Summary); without it the row stays (a sender's page lists archived issues too).
 */
export function useSwipeRating(opts: {
  patch: (id: string, change: SwipeChange) => void;
  hide?: (id: string, gone: boolean) => void;
}) {
  const { api } = useApp();
  const { counts } = useLibrary();
  const [toast, setToast] = useState<{ key: number; text: string; undo?: () => void }>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const say = (text: string, undo?: () => void) => {
    clearTimeout(timer.current);
    const key = Date.now();
    setToast({ key, text, undo });
    timer.current = setTimeout(() => setToast((t) => (t?.key === key ? undefined : t)), UNDO_MS);
  };

  const send = async (id: string, change: SwipeChange) => {
    await Promise.all([
      "rating" in change ? api.rate(id, change.rating ?? 0) : undefined,
      change.state ? api.setState(id, change.state) : undefined,
    ]);
    if (change.state) counts.reload();
  };

  const run = (issue: IssueListItem, way: SwipeWay) => {
    const change = swipeChange(issue, way);
    if (!change) return;
    const undo: SwipeChange = {
      ...("rating" in change ? { rating: issue.rating } : {}),
      ...(change.state ? { state: issue.state } : {}),
    };
    const leaves = change.state === "archived" ? opts.hide : undefined;
    const apply = (c: SwipeChange, gone: boolean) => {
      leaves?.(issue.id, gone);
      opts.patch(issue.id, c);
    };

    apply(change, true);
    const sent = send(issue.id, change).then(
      () => true,
      (err: Error) => {
        apply(undo, false);
        say(`Not saved: ${err.message}`);
        return false;
      },
    );
    if (!change.state) return;
    say("Archived.", () => {
      setToast(undefined);
      apply(undo, false);
      // Undo waits for the archive to land, then reverses it.
      void sent.then(async (ok) => {
        if (!ok) return;
        try {
          await send(issue.id, undo);
        } catch (err) {
          apply(change, true);
          say(`Undo failed: ${(err as Error).message}`);
        }
      });
    });
  };

  return {
    actions: (issue: IssueListItem): SwipeActions => ({
      right: swipeChange(issue, "right") ? () => run(issue, "right") : undefined,
      left: swipeChange(issue, "left") ? () => run(issue, "left") : undefined,
      leaves: Boolean(opts.hide) && issue.state !== "archived",
    }),
    toast: (
      <div class="toast-slot" role="status">
        {toast && (
          <div key={toast.key} class="toast">
            <span>{toast.text}</span>
            {toast.undo && (
              <button type="button" class="link" onClick={toast.undo}>
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    ),
  };
}
