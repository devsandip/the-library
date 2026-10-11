/**
 * Related issues (#20): nearest neighbours on the embeddings enrichment stores, worked out when
 * an issue is opened. No Claude call and nothing stored. Since the second version, this whole-issue
 * match serves only issues not split into stories; `relatedStories` below serves the rest.
 *
 * Before comparing, each embedding loses the corpus mean and its newsletter's own mean, so a
 * newsletter's house style does not count as relatedness. On prod (2026-10-10, 404 issues), raw
 * cosines averaged 0.34 between issues of one newsletter and 0.19 across newsletters, and the
 * nearest neighbours of most digests were the same digest on other days.
 */

/** Below this, an issue is not shown as related (centred cosine, picked from prod pairs). */
export const RELATED_CUTOFF = 0.27;
/** At most this many on each side, Earlier and Since. */
export const RELATED_PER_SIDE = 3;
/** A newsletter's own mean counts n / (n + 3): with few issues, little of its style comes off. */
const SENDER_SHRINK = 3;

export interface RelatedCandidate {
  id: string;
  senderId: string;
  receivedAt: string;
  vector: ArrayLike<number>;
}

export interface RelatedMatch {
  id: string;
  similarity: number;
}

export interface RelatedResult {
  /** Received before the issue, most similar first. */
  earlier: RelatedMatch[];
  /** Received after it, most similar first. */
  since: RelatedMatch[];
}

function unit(v: ArrayLike<number>): Float64Array {
  const out = Float64Array.from(v);
  const norm = Math.hypot(...out);
  if (norm > 0) for (let i = 0; i < out.length; i++) out[i]! /= norm;
  return out;
}

/**
 * The issues closest to `targetId` in `corpus` (which includes it), above the cutoff, split by
 * whether they arrived before or after it. `eligible` leaves issues out of the result (promos,
 * muted newsletters) while they still count toward the means.
 */
export function relatedIssues(
  targetId: string,
  corpus: RelatedCandidate[],
  opts: {
    eligible?: (c: RelatedCandidate) => boolean;
    cutoff?: number;
    perSide?: number;
  } = {},
): RelatedResult {
  const { eligible = () => true, cutoff = RELATED_CUTOFF, perSide = RELATED_PER_SIDE } = opts;
  const target = corpus.find((c) => c.id === targetId);
  if (!target) return { earlier: [], since: [] };
  const dims = target.vector.length;
  const items = corpus.filter((c) => c.vector.length === dims);
  const units = items.map((c) => unit(c.vector));

  const global = new Float64Array(dims);
  for (const u of units) for (let i = 0; i < dims; i++) global[i]! += u[i]! / units.length;
  const senders = new Map<string, { sum: Float64Array; n: number }>();
  items.forEach((c, k) => {
    const s = senders.get(c.senderId) ?? { sum: new Float64Array(dims), n: 0 };
    for (let i = 0; i < dims; i++) s.sum[i]! += units[k]![i]! - global[i]!;
    s.n++;
    senders.set(c.senderId, s);
  });
  const centred = (k: number): Float64Array => {
    // The newsletter's mean (sum / n), counted n / (n + SENDER_SHRINK): sum / (n + SENDER_SHRINK).
    const s = senders.get(items[k]!.senderId)!;
    const out = new Float64Array(dims);
    for (let i = 0; i < dims; i++) {
      out[i] = units[k]![i]! - global[i]! - s.sum[i]! / (s.n + SENDER_SHRINK);
    }
    return unit(out);
  };

  const t = centred(items.indexOf(target));
  const matches = items
    .map((c, k) => {
      if (c.id === targetId || !eligible(c)) return undefined;
      const v = centred(k);
      let dot = 0;
      for (let i = 0; i < dims; i++) dot += t[i]! * v[i]!;
      return { c, similarity: dot };
    })
    .filter((m): m is { c: RelatedCandidate; similarity: number } => !!m && m.similarity >= cutoff)
    .sort((a, b) => b.similarity - a.similarity);

  const side = (before: boolean) =>
    matches
      .filter((m) => m.c.receivedAt < target.receivedAt === before)
      .slice(0, perSide)
      .map((m) => ({ id: m.c.id, similarity: m.similarity }));
  return { earlier: side(true), since: side(false) };
}

/*
 * Related stories (#20, second version): the same nearest neighbours, on the story index's
 * embeddings (#15), so a story inside a digest finds its own relatives. Claude wrote every story's
 * headline and summary, so a newsletter's house style barely shows: on prod (2026-10-11, 2,264
 * stories), raw cosines averaged 0.10 between stories of one newsletter and 0.07 across. No
 * centring, then.
 */

/** Below this, a story is not shown as related (raw cosine, picked by reading prod pairs). */
export const STORY_RELATED_CUTOFF = 0.45;
/** The same newsletter's story at least this close is a rerun of it, not a relative. */
export const RERUN_SIMILAR = 0.8;
/** At most this many relatives for each story of a digest, the closest. */
export const RELATED_PER_STORY = 3;

export interface StoryCandidate {
  issueId: string;
  n: number;
  senderId: string;
  receivedAt: string;
  /** Normalized, as Titan returns it: a dot product is the cosine. */
  vector: ArrayLike<number>;
}

export interface StoryMatch {
  issueId: string;
  /** The matching story in that issue. */
  n: number;
  receivedAt: string;
  similarity: number;
}

export interface StorySides {
  earlier: StoryMatch[];
  since: StoryMatch[];
}

/** Related stories for each story of a digest that has any, in the order they appear. */
export interface RelatedStories extends StorySides {
  stories: (StorySides & { n: number })[];
}

/**
 * Stories from other issues close to `story`, closest first, at least `cutoff`: one per issue,
 * its closest story. The same newsletter's reruns are left out.
 */
export function closestStories(
  story: StoryCandidate,
  corpus: StoryCandidate[],
  opts: { eligible?: (c: StoryCandidate) => boolean; cutoff?: number } = {},
): StoryMatch[] {
  const { eligible = () => true, cutoff = STORY_RELATED_CUTOFF } = opts;
  const best = new Map<string, StoryMatch>();
  for (const c of corpus) {
    if (c.issueId === story.issueId || c.vector.length !== story.vector.length) continue;
    let dot = 0;
    for (let i = 0; i < c.vector.length; i++) dot += story.vector[i]! * c.vector[i]!;
    if (dot < cutoff || (c.senderId === story.senderId && dot >= RERUN_SIMILAR)) continue;
    if ((best.get(c.issueId)?.similarity ?? -1) >= dot || !eligible(c)) continue;
    best.set(c.issueId, { issueId: c.issueId, n: c.n, receivedAt: c.receivedAt, similarity: dot });
  }
  return [...best.values()].sort((a, b) => b.similarity - a.similarity);
}

/**
 * Related stories for an issue's own `stories`. One story is the issue itself: up to `perSide`
 * each side of its date, like the first version. A digest gets them per story instead, up to
 * `perStory` each, so the section stays as long as the digest's stories with relatives.
 */
export function relatedStories(
  stories: StoryCandidate[],
  corpus: StoryCandidate[],
  opts: {
    eligible?: (c: StoryCandidate) => boolean;
    cutoff?: number;
    perSide?: number;
    perStory?: number;
  } = {},
): RelatedStories {
  const { perSide = RELATED_PER_SIDE, perStory = RELATED_PER_STORY } = opts;
  const split = (matches: StoryMatch[], at: string, limit: number): StorySides => ({
    earlier: matches.filter((m) => m.receivedAt < at).slice(0, limit),
    since: matches.filter((m) => m.receivedAt >= at).slice(0, limit),
  });
  if (stories.length === 1) {
    const [story] = stories;
    return {
      ...split(closestStories(story!, corpus, opts), story!.receivedAt, perSide),
      stories: [],
    };
  }
  const groups = [...stories]
    .sort((a, b) => a.n - b.n)
    .flatMap((s) => {
      const matches = closestStories(s, corpus, opts).slice(0, perStory);
      return matches.length ? [{ n: s.n, ...split(matches, s.receivedAt, perStory) }] : [];
    });
  return { earlier: [], since: [], stories: groups };
}
