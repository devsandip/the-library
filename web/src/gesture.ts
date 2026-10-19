export type SwipeWay = "right" | "left";

/** Today's deck moves to the next or previous card past this many pixels. */
export const CARD_COMMIT_PX = 100;
/** Movement before a card decides whether the finger is swiping it or scrolling the page. */
export const LOCK_PX = 8;
/** Less movement than this is a tap on a deck card. */
export const TAP_PX = 6;
/** A flick at least this fast, in pixels per millisecond, commits a shorter drag... */
export const FLICK_SPEED = 0.5;
/** ...as long as it travelled this far. */
export const FLICK_MIN_PX = 32;
/** Gestures must start this far in from the screen's edges: iOS owns the edge swipe for Back. */
export const EDGE_PX = 20;

/**
 * Which way a released drag commits, if it does: past the threshold, or a quick flick the same
 * way it was dragged. Anything less springs back.
 */
export function swipeDecision(dx: number, threshold: number, speed: number): SwipeWay | undefined {
  if (dx === 0) return undefined;
  const way: SwipeWay = dx > 0 ? "right" : "left";
  if (Math.abs(dx) >= threshold) return way;
  const flick =
    Math.abs(dx) >= FLICK_MIN_PX &&
    Math.abs(speed) >= FLICK_SPEED &&
    Math.sign(speed) === Math.sign(dx);
  return flick ? way : undefined;
}

/**
 * Whether a drag that has moved (dx, dy) is the card's (sideways) or the page's (a scroll), once
 * it has moved far enough to tell; undefined until then.
 */
export function directionLock(dx: number, dy: number): "x" | "y" | undefined {
  if (Math.hypot(dx, dy) < LOCK_PX) return undefined;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

/** How a deck card sits under the finger: it follows, turning about its bottom edge. */
export function cardTransform(dx: number): string {
  return `translateX(${dx}px) rotate(${(dx / 22).toFixed(2)}deg)`;
}

/** How strongly a swipe label shows, from the drag distance. */
export const labelOpacity = (dx: number) => Math.min(1, Math.abs(dx) / 100);

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Where Today's deck goes on a swipe: left is the next card, right the one before. Position -1 is
 * the day's brief, which sits before the first card when there is one. Undefined at either end,
 * where the card springs back.
 */
export function deckStep(
  at: number,
  way: SwipeWay,
  cards: number,
  brief: boolean,
): number | undefined {
  const to = way === "left" ? at + 1 : at - 1;
  return to >= cards || to < (brief ? -1 : 0) ? undefined : to;
}
