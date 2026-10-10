/**
 * The place in a newsletter, for Now reading (#44). The window scrolls, not the newsletter's
 * frame (the frame is sized to its content), so the place is the share of the frame above the
 * top of the screen. A share rather than pixels, so a place saved on the Mac lands near the same
 * words on the phone, where the newsletter is narrower and so taller.
 */

/** Where the frame sits in the page, and how much of the page is on screen, in CSS pixels. */
export interface FrameView {
  /** The window's scroll offset. */
  scrollY: number;
  /** The height of the screen. */
  viewport: number;
  /** The frame's top, from the top of the page. */
  top: number;
  height: number;
}

/** The end counts as reached this close to the bottom: newsletters close on a footer. */
const END_SHARE = 0.05;
const END_MAX_PX = 600;

/** The share of the newsletter above the top of the screen, to 3 decimals, below 1. */
export function placeIn(v: FrameView): number {
  if (v.height <= 0) return 0;
  const share = Math.min(Math.max((v.scrollY - v.top) / v.height, 0), 1);
  // 1 means finished, which only the end of the newsletter decides.
  return Math.min(Math.round(share * 1000) / 1000, 0.999);
}

/** Whether the bottom of the screen has reached the end of the newsletter, give or take its footer. */
export function atEnd(v: FrameView): boolean {
  if (v.height <= 0) return false;
  const slack = Math.min(v.height * END_SHARE, END_MAX_PX);
  return v.scrollY + v.viewport >= v.top + v.height - slack;
}

/** The scroll offset that puts a place back at the top of the screen. */
export function scrollFor(place: number, v: Pick<FrameView, "top" | "height">): number {
  return Math.round(v.top + place * v.height);
}
