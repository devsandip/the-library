/**
 * The story index (#15): Claude splits each issue into its stories, Titan embeds each one, and
 * stories about the same event share an event id, across newsletters. Linking runs in arrival
 * order: a story joins the event of the closest qualifying story from another issue a few days
 * either side, or starts its own. No merging: a story that fits two events joins the closer one.
 */
import { cosine } from "./rank.js";

/** Stories further apart than this are never one event. */
export const EVENT_WINDOW_DAYS = 3;
/** Similar enough to be one event on its own (cosine of Titan embeddings). */
export const EVENT_SIMILAR = 0.8;
/** Similar enough when the two stories also name the same company, person or product. */
export const EVENT_SIMILAR_NAMED = 0.6;

const DAY_MS = 86_400_000;

export interface EventCandidate {
  /** `<issueId>#<n>` */
  key: string;
  issueId: string;
  receivedAt: string;
  names: string[];
  vector: ArrayLike<number>;
  /** Set once the story is linked. */
  eventId?: string;
}

export interface EventOptions {
  windowDays?: number;
  similar?: number;
  similarNamed?: number;
}

export interface EventMatch {
  eventId: string;
  /** The story it was linked to, when it joined an existing event. */
  key?: string;
  similarity?: number;
}

/** The story key, `<issueId>#<n>`, which is also the id of an event the story starts. */
export const storyRef = (issueId: string, n: number) => `${issueId}#${String(n).padStart(2, "0")}`;

/** Names compare loosely: case, punctuation and a leading "The" do not count. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^the /, "");
}

/**
 * The event a story belongs to: that of the most similar linked story from another issue within
 * the window, if it is similar enough (or nearly so and shares a name); else a new event named
 * after the story itself.
 */
export function eventFor(
  story: EventCandidate,
  others: EventCandidate[],
  opts: EventOptions = {},
): EventMatch {
  const {
    windowDays = EVENT_WINDOW_DAYS,
    similar = EVENT_SIMILAR,
    similarNamed = EVENT_SIMILAR_NAMED,
  } = opts;
  const at = Date.parse(story.receivedAt);
  const names = new Set(story.names.map(nameKey).filter(Boolean));
  let best: { other: EventCandidate; similarity: number } | undefined;
  for (const other of others) {
    if (!other.eventId || other.issueId === story.issueId) continue;
    if (Math.abs(Date.parse(other.receivedAt) - at) > windowDays * DAY_MS) continue;
    const similarity = cosine(story.vector, other.vector);
    if (similarity < similarNamed || (best && similarity <= best.similarity)) continue;
    if (similarity < similar && !other.names.some((n) => names.has(nameKey(n)))) continue;
    best = { other, similarity };
  }
  return best
    ? { eventId: best.other.eventId!, key: best.other.key, similarity: best.similarity }
    : { eventId: story.key };
}

/** Event ids for every story, linked in arrival order: for relinking after a threshold change. */
export function linkEvents(
  stories: EventCandidate[],
  opts: EventOptions = {},
): Map<string, string> {
  const windowMs = (opts.windowDays ?? EVENT_WINDOW_DAYS) * DAY_MS;
  const sorted = [...stories].sort(
    (a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.key.localeCompare(b.key),
  );
  const linked: EventCandidate[] = [];
  const out = new Map<string, string>();
  let from = 0;
  for (const story of sorted) {
    // `linked` is in arrival order: skip what fell out of the window.
    const start = Date.parse(story.receivedAt) - windowMs;
    while (from < linked.length && Date.parse(linked[from]!.receivedAt) < start) from++;
    const { eventId } = eventFor(story, linked.slice(from), opts);
    out.set(story.key, eventId);
    linked.push({ ...story, eventId });
  }
  return out;
}
