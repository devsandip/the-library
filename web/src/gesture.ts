import type { IssueListItem } from "@library/core/types";

export type SwipeWay = "right" | "left";

/** Past this share of the row's width, letting go commits a swipe (#13). */
export const COMMIT_SHARE = 0.4;
/** A flick at least this fast, in pixels per millisecond, commits a shorter drag... */
export const FLICK_SPEED = 0.5;
/** ...as long as it travelled this far. */
export const FLICK_MIN_PX = 32;

/**
 * Which way a released drag commits, if it does: past 40% of the row's width, or a quick flick
 * the same way it was dragged. Anything less springs back.
 */
export function swipeDecision(dx: number, width: number, speed: number): SwipeWay | undefined {
  if (dx === 0) return undefined;
  const way: SwipeWay = dx > 0 ? "right" : "left";
  if (Math.abs(dx) >= COMMIT_SHARE * width) return way;
  const flick =
    Math.abs(dx) >= FLICK_MIN_PX &&
    Math.abs(speed) >= FLICK_SPEED &&
    Math.sign(speed) === Math.sign(dx);
  return flick ? way : undefined;
}

export type SwipeChange = Partial<Pick<IssueListItem, "rating" | "state">>;

/**
 * What a swipe changes: right rates Relevant; left rates Irrelevant and archives. Undefined when
 * it would change nothing, so a second swipe the same way does nothing.
 */
export function swipeChange(
  issue: Pick<IssueListItem, "rating" | "state">,
  way: SwipeWay,
): SwipeChange | undefined {
  if (way === "right") return issue.rating === 1 ? undefined : { rating: 1 };
  const change: SwipeChange = {
    ...(issue.rating === -1 ? {} : { rating: -1 }),
    ...(issue.state === "archived" ? {} : { state: "archived" }),
  };
  return Object.keys(change).length ? change : undefined;
}
