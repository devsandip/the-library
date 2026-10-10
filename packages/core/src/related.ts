/**
 * Related issues (#20): nearest neighbours on the embeddings enrichment stores, worked out when
 * an issue is opened. No Claude call and nothing stored.
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
