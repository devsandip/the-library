import type { IssueListItem } from "@library/core/types";

export type SwipeWay = "right" | "left";

/** Browse rows commit past this many pixels (#13, the redesign). */
export const ROW_COMMIT_PX = 90;
/** Today's deck commits a card past this many pixels. */
export const CARD_COMMIT_PX = 100;
/** Movement before a row decides whether the finger is swiping it or scrolling the list. */
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
 * Whether a drag that has moved (dx, dy) is the row's (sideways) or the list's (a scroll), once
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

export type SwipeChange = Partial<Pick<IssueListItem, "rating" | "state" | "savedAt">>;

/**
 * What a swipe changes: right rates Relevant; left rates Irrelevant and archives, which also takes
 * a saved issue off the Saved list (#43). Undefined when it would change nothing, so a second
 * swipe the same way does nothing.
 */
export function swipeChange(
  issue: Pick<IssueListItem, "rating" | "state" | "savedAt">,
  way: SwipeWay,
): SwipeChange | undefined {
  if (way === "right") return issue.rating === 1 ? undefined : { rating: 1 };
  const change: SwipeChange = {
    ...(issue.rating === -1 ? {} : { rating: -1 }),
    ...(issue.state === "archived" ? {} : { state: "archived" }),
    ...(issue.state !== "archived" && issue.savedAt !== undefined ? { savedAt: undefined } : {}),
  };
  return Object.keys(change).length ? change : undefined;
}

/** The fields to put back so a change is undone (rule 4: rating, archive and saved together). */
export function undoOf(issue: IssueListItem, change: SwipeChange): SwipeChange {
  return {
    ...("rating" in change ? { rating: issue.rating } : {}),
    ...("state" in change ? { state: issue.state } : {}),
    ...("savedAt" in change ? { savedAt: issue.savedAt } : {}),
  };
}
