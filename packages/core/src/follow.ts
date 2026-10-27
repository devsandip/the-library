/**
 * Follow a story (#22): a followed story is its event (#15) with dated points, the ones it was
 * followed with and each move the check after an ingest adds. The API follows, lists and unfollows;
 * ingest adds the moves. Pure, so both services and the tests share one set of rules.
 */
import { storyRef } from "./stories.js";
import type { Follow, FollowPoint } from "./types.js";

/** A followed story with no movement for this long goes quiet: listed apart, no longer checked. */
export const FOLLOW_QUIET_DAYS = 30;
/** At most this many followed stories, so the check after each ingest stays one small call. */
export const FOLLOW_LIMIT = 20;

const DAY_MS = 86_400_000;

/** A followed story as stored: what the app shows, and what the check has already read. */
export interface StoredFollow {
  eventId: string;
  /** The story followed, which Following opens. */
  issueId: string;
  n: number;
  headline: string;
  publication: string;
  followedAt: string;
  /** When the newest move came: its story's date. Absent before the first move. */
  movedAt?: string;
  /** When Sandip last looked at Following; points added after it are new. */
  seenAt: string;
  points: FollowPoint[];
  /** Stories the check has read for it ("<issueId>#<nn>"), so none is asked about twice. */
  checked: string[];
}

/** Since when a followed story has been still: its newest move, or when it was followed. */
export const stillSince = (f: Pick<StoredFollow, "followedAt" | "movedAt">): string =>
  f.movedAt && f.movedAt > f.followedAt ? f.movedAt : f.followedAt;

export const isQuiet = (f: Pick<StoredFollow, "followedAt" | "movedAt">, now: number): boolean =>
  Date.parse(stillSince(f)) < now - FOLLOW_QUIET_DAYS * DAY_MS;

/** Every story a follow's points draw on, and the story followed, as story refs. */
export function followStories(f: Pick<StoredFollow, "issueId" | "n" | "points">): string[] {
  const refs = f.points.flatMap((p) => p.sources.map((s) => storyRef(s.issueId, s.story?.n ?? 1)));
  return [...new Set([storyRef(f.issueId, f.n), ...refs])];
}

/** A stored follow as the app sees it. */
export function followView(f: StoredFollow, now: number): Follow {
  return {
    eventId: f.eventId,
    issueId: f.issueId,
    n: f.n,
    headline: f.headline,
    publication: f.publication,
    followedAt: f.followedAt,
    ...(f.movedAt ? { movedAt: f.movedAt } : {}),
    // A move can come from a story older than the newest point (an issue split late).
    points: [...f.points].sort((a, b) => a.at.localeCompare(b.at)),
    unseen: f.points.filter((p) => p.added && p.added > f.seenAt).length,
    quiet: isQuiet(f, now),
    stories: followStories(f),
  };
}

/** Followed stories as Following lists them: moving ones first, latest movement first. */
export function followOrder(a: Follow, b: Follow): number {
  return (
    Number(a.quiet) - Number(b.quiet) ||
    stillSince(b).localeCompare(stillSince(a)) ||
    a.eventId.localeCompare(b.eventId)
  );
}
