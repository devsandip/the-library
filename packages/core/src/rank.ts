/**
 * Relevance ranking (docs/architecture.md section 11) as pure functions. The API scores the
 * Summary page's candidates at read time with these; nothing here touches storage.
 *
 *   score = 0.40 * sender + 0.40 * topic + 0.20 * fresh
 */
import type { Rating } from "./types.js";

export const WEIGHTS = { sender: 0.4, topic: 0.4, fresh: 0.2 } as const;

/** Candidates are unread issues from the last two weeks. */
export const CANDIDATE_DAYS = 14;

/** The Summary shows at most this many issues from one newsletter, unless that leaves it short. */
export const SUMMARY_PER_SENDER = 3;

/** The digest: the Summary's top 5, logged when first shown each day (the PRD's "top 5"). */
export const DIGEST_SIZE = 5;
/** The success measure looks back this many days. */
export const DIGEST_DAYS = 14;

/**
 * The five interests from the PRD. They seed the taste profile, so ranking works before the
 * first rating. Enrichment embeds `text` once and stores the vectors (CONFIG/INTERESTS).
 */
export const INTERESTS: readonly { name: string; text: string }[] = [
  {
    name: "the tech industry",
    text: "The tech industry: big tech companies, platforms, competition and regulation.",
  },
  {
    name: "startups",
    text: "Startups: founders, fundraising, venture capital and building a company.",
  },
  { name: "AI", text: "AI: language models, AI products, research and the AI industry." },
  {
    name: "product management",
    text: "Product management: strategy, discovery, roadmaps, metrics and the craft of product.",
  },
  {
    name: "system design",
    text: "System design: software architecture, distributed systems, databases and scaling.",
  },
];

/** The interests count as this many ratings, so a few real ratings move the profile. */
const INTEREST_PSEUDO_COUNT = 5;
/** A rating's pull on the profile halves every 60 days. */
const RATING_HALF_LIFE_DAYS = 60;
/** Freshness halves every 48 hours. */
const FRESH_HALF_LIFE_HOURS = 48;
const DISLIKE_WEIGHT = 0.5;

type Vector = ArrayLike<number>;

export interface RankCandidate {
  id: string;
  senderId: string;
  receivedAt: string;
  /** Titan embedding; absent until enrichment has run. */
  vector?: Vector;
}

export interface RankSender {
  mustRead: boolean;
  up: number;
  down: number;
}

export interface RatedIssue {
  id: string;
  subject: string;
  rating: Rating;
  ratedAt: string;
  vector: Vector;
}

export interface InterestVector {
  name: string;
  vector: Vector;
}

export interface RankInput {
  candidates: RankCandidate[];
  senders: Map<string, RankSender>;
  interests: InterestVector[];
  rated: RatedIssue[];
  now: number;
  /** The reader's calendar day, YYYY-MM-DD (see `readerDay`). */
  day: string;
}

export interface Ranked {
  id: string;
  senderId: string;
  score: number;
  parts: { sender: number; topic: number; fresh: number };
  reason: string;
}

/** mulberry32 seeded with an FNV-1a hash of the string: the same seed gives the same numbers. */
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A draw from Beta(a, b) for whole-number a and b: the a-th smallest of a + b - 1 uniform draws.
 * Priors and rating counts are whole numbers, so this exact method is all ranking needs.
 */
export function betaSample(a: number, b: number, rand: () => number): number {
  const alpha = Math.max(1, Math.round(a));
  const beta = Math.max(1, Math.round(b));
  const draws = Array.from({ length: alpha + beta - 1 }, rand).sort((x, y) => x - y);
  return draws[alpha - 1]!;
}

/** Thompson sample of how much Sandip likes a sender. Must Read starts at Beta(3,1), others (2,2). */
export function senderScore(senderId: string, s: RankSender | undefined, day: string): number {
  const [a0, b0] = s?.mustRead ? [3, 1] : [2, 2];
  return betaSample(a0 + (s?.up ?? 0), b0 + (s?.down ?? 0), seededRandom(`${day}#${senderId}`));
}

export function freshness(receivedAt: string, now: number): number {
  const hours = Math.max(0, (now - Date.parse(receivedAt)) / 3_600_000);
  return 0.5 ** (hours / FRESH_HALF_LIFE_HOURS);
}

export function cosine(a: Vector, b: Vector): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Weighted mean of vectors; undefined when there is nothing to average. */
function centroid(parts: { vector: Vector; weight: number }[]): Float64Array | undefined {
  const total = parts.reduce((n, p) => n + p.weight, 0);
  if (!parts.length || total <= 0) return undefined;
  const out = new Float64Array(parts[0]!.vector.length);
  for (const p of parts) {
    for (let i = 0; i < out.length; i++) out[i]! += (p.vector[i]! * p.weight) / total;
  }
  return out;
}

function ratingWeight(ratedAt: string, now: number): number {
  const days = Math.max(0, (now - Date.parse(ratedAt)) / 86_400_000);
  return 0.5 ** (days / RATING_HALF_LIFE_DAYS);
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26), to map z-scores onto 0..1. */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * Score every candidate, best first. The topic part is cosine to the liked profile minus half the
 * cosine to the disliked one, z-scored across candidates and mapped to 0..1 with the normal CDF
 * so the three parts share a scale. Candidates without an embedding sit at the middle (0.5).
 */
export function rank(input: RankInput): Ranked[] {
  const { candidates, senders, interests, rated, now, day } = input;
  const useful = rated.filter((r) => r.rating === 1);
  const liked = centroid([
    ...interests.map((i) => ({
      vector: i.vector,
      weight: INTEREST_PSEUDO_COUNT / interests.length,
    })),
    ...useful.map((r) => ({ vector: r.vector, weight: ratingWeight(r.ratedAt, now) })),
  ]);
  const disliked = centroid(
    rated
      .filter((r) => r.rating === -1)
      .map((r) => ({ vector: r.vector, weight: ratingWeight(r.ratedAt, now) })),
  );

  const raw = candidates.map((c) =>
    c.vector && (liked || disliked)
      ? (liked ? cosine(c.vector, liked) : 0) -
        (disliked ? DISLIKE_WEIGHT * cosine(c.vector, disliked) : 0)
      : undefined,
  );
  const known = raw.filter((r): r is number => r !== undefined);
  const mean = known.length ? known.reduce((n, r) => n + r, 0) / known.length : 0;
  const sd = known.length
    ? Math.sqrt(known.reduce((n, r) => n + (r - mean) ** 2, 0) / known.length)
    : 0;

  const scored = candidates.map((c, i) => {
    const r = raw[i];
    const parts = {
      sender: senderScore(c.senderId, senders.get(c.senderId), day),
      topic: r === undefined || sd === 0 ? 0.5 : normalCdf((r - mean) / sd),
      fresh: freshness(c.receivedAt, now),
    };
    const score =
      WEIGHTS.sender * parts.sender + WEIGHTS.topic * parts.topic + WEIGHTS.fresh * parts.fresh;
    return { c, parts, score };
  });

  const avg = (k: keyof Ranked["parts"]) =>
    scored.reduce((n, s) => n + s.parts[k], 0) / Math.max(1, scored.length);
  const means = { sender: avg("sender"), topic: avg("topic"), fresh: avg("fresh") };
  const closest = closestAnchor(candidates, [
    ...interests.map((i) => ({ text: `Close to your interest in ${i.name}`, vector: i.vector })),
    ...useful.map((r) => ({
      text: `Like "${clip(r.subject, 60)}", which you found useful`,
      vector: r.vector,
    })),
  ]);

  return scored
    .map(({ c, parts, score }, i) => ({
      id: c.id,
      senderId: c.senderId,
      score,
      parts,
      reason: reasonFor(c, parts, means, senders.get(c.senderId), closest(i), now),
    }))
    .sort((x, y) => y.score - x.score || y.id.localeCompare(x.id));
}

/**
 * For each candidate, the interest or thumbed-up issue it is unusually close to, judged
 * against the other candidates (a z-score per anchor). Raw cosines would always name a rated
 * issue: newsletters sit closer to one another than to a one-line interest.
 */
function closestAnchor(
  candidates: RankCandidate[],
  anchors: { text: string; vector: Vector }[],
): (candidate: number) => string | undefined {
  const sims = candidates.map((c) =>
    c.vector ? anchors.map((a) => cosine(c.vector!, a.vector)) : undefined,
  );
  const known = sims.filter((s): s is number[] => s !== undefined);
  const stats = anchors.map((_, k) => {
    const xs = known.map((s) => s[k]!);
    const mean = xs.reduce((n, x) => n + x, 0) / Math.max(1, xs.length);
    const sd = Math.sqrt(xs.reduce((n, x) => n + (x - mean) ** 2, 0) / Math.max(1, xs.length));
    return { mean, sd };
  });
  return (i) => {
    const s = sims[i];
    if (!s) return undefined;
    let best: { text: string; z: number } | undefined;
    s.forEach((x, k) => {
      const { mean, sd } = stats[k]!;
      const z = sd > 0 ? (x - mean) / sd : 0;
      if (!best || z > best.z) best = { text: anchors[k]!.text, z };
    });
    return best?.text;
  };
}

/**
 * The Summary's picks, still best first: at most `perSender` from one newsletter, so one
 * prolific Must Read cannot fill the page. If that leaves fewer than `limit`, the best of the
 * rest fill in.
 */
export function pickTop<T extends { id: string; senderId: string }>(
  ranked: T[],
  limit: number,
  perSender = SUMMARY_PER_SENDER,
): T[] {
  const picked = new Set<string>();
  const taken = new Map<string, number>();
  for (const r of ranked) {
    if (picked.size >= limit) break;
    const n = taken.get(r.senderId) ?? 0;
    if (n >= perSender) continue;
    picked.add(r.id);
    taken.set(r.senderId, n + 1);
  }
  for (const r of ranked) {
    if (picked.size >= limit) break;
    picked.add(r.id);
  }
  return ranked.filter((r) => picked.has(r.id));
}

/** One line on why an issue ranks where it does: the part that lifts it most above average. */
function reasonFor(
  c: RankCandidate,
  parts: Ranked["parts"],
  means: Ranked["parts"],
  sender: RankSender | undefined,
  closest: string | undefined,
  now: number,
): string {
  const lift = (["sender", "topic", "fresh"] as const)
    .map((k) => ({ k, d: WEIGHTS[k] * (parts[k] - means[k]) }))
    .sort((x, y) => y.d - x.d);
  for (const { k } of lift) {
    if (k === "sender") {
      const up = sender?.up ?? 0;
      const down = sender?.down ?? 0;
      if (up > 0 && up >= down) return `You found this newsletter useful ${times(up)}`;
      if (sender?.mustRead) return "From a Must Read newsletter";
      if (up + down === 0) return "Trying a newsletter you haven't rated yet";
      continue;
    }
    if (k === "topic") {
      if (closest) return closest;
      continue;
    }
    const hours = (now - Date.parse(c.receivedAt)) / 3_600_000;
    return hours < 3 ? "Just in" : "Among the newest";
  }
  return "Among the newest";
}

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s);
