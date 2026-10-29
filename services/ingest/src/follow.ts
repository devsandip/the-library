/**
 * Follow a story (#22), the check after each ingest: every followed story that is not quiet,
 * against the stories of the last three days. A story is a candidate when it is in the follow's
 * event (#15) or reads like one of its stories. One Claude call for all of them names each
 * followed story's matter narrowly, calls every candidate a move, a repeat or other news, and
 * words the moves; each becomes a dated point, new until Sandip looks. Every candidate is
 * remembered, so none is asked about twice.
 */
import {
  followStories,
  isQuiet,
  READER,
  READER_TIME_ZONE,
  readerDay,
  STORY_RELATED_CUTOFF,
  type StoredFollow,
} from "@library/core";
import type { FollowPoint, TimelineSource } from "@library/core/types";
import type { ModelPort, ToolRequest } from "./bedrock.js";
import type { Store } from "./store.js";

/** How far back the check reads: a story split late still has its chance. */
export const FOLLOW_WINDOW_DAYS = 3;
/** At most this many candidates for one follow, the closest. */
export const FOLLOW_CANDIDATES = 8;
/** A follow's stories its candidates are compared with: the story followed and its newest. */
const ANCHORS = 6;
/** Story refs remembered as checked, the newest. */
const CHECKED_KEEP = 300;
const DAY_MS = 86_400_000;

/** What one check did, for the log. */
export interface FollowStats {
  /** Followed stories checked: those not quiet. */
  follows: number;
  candidates: number;
  moves: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

/** A recent story as the check reads it. */
export interface RecentStory {
  key: string;
  issueId: string;
  n: number;
  senderId: string;
  receivedAt: string;
  eventId: string;
  headline: string;
  summary: string;
  names: string[];
  vector: ArrayLike<number>;
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

/** The stories of a follow its candidates are compared with: the story followed, its newest. */
export function anchorRefs(follow: StoredFollow): string[] {
  const [followed, ...rest] = followStories(follow);
  return [followed!, ...rest.slice(-ANCHORS)];
}

/**
 * A follow's candidates among recent stories: its event's, or close to one of its stories, not
 * its own, not checked before and not from a muted newsletter. The closest, oldest first.
 */
export function followCandidates(
  follow: StoredFollow,
  anchors: ArrayLike<number>[],
  recent: RecentStory[],
  muted: Set<string>,
): RecentStory[] {
  const skip = new Set([...followStories(follow), ...follow.checked]);
  return recent
    .filter((s) => !skip.has(s.key) && !muted.has(s.senderId))
    .map((s) => ({
      s,
      score:
        s.eventId === follow.eventId ? 1 : Math.max(0, ...anchors.map((a) => dot(a, s.vector))),
    }))
    .filter((c) => c.score >= STORY_RELATED_CUTOFF)
    .sort((a, b) => b.score - a.score)
    .slice(0, FOLLOW_CANDIDATES)
    .map((c) => c.s)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.key.localeCompare(b.key));
}

/** What Claude reads: each follow ("F1") with its points, and its candidates ("S1" and up). */
export interface MoveItem {
  id: string;
  follow: StoredFollow;
  stories: { id: string; story: RecentStory; publication: string; digest: boolean }[];
}

/** What a candidate is to its followed story; only a move's stories make a point. */
const KINDS = ["move", "repeat", "other"] as const;

export function movesRequest(items: MoveItem[], timeZone = READER_TIME_ZONE): ToolRequest {
  return {
    system: [
      `You keep one reader up to date on the stories they follow, from their own newsletters. ${READER}`,
      "",
      "The user sends each followed story as F1, F2 and so on: the steps it has taken so far, " +
        "oldest first and dated. Under each, new stories from the reader's newsletters, as S1, S2 " +
        "and so on: the date, the newsletter, the headline and summary, and the names involved. " +
        "They were picked because they read alike, and many are repeats or other news.",
      "Call record_moves:",
      "- matters: for each followed story, the one matter its steps follow, named narrowly in " +
        "a few words: who did what (for example, Anthropic's pledge of 5% of its shares to a " +
        "fund, not Anthropic).",
      "- stories: every new story, each with its kind, judged against its own followed story's " +
        "matter. move: a new step in that matter, beyond its steps: something that happened " +
        "(a decision, a result, an answer, a launch, a setback, a figure that changed). repeat: " +
        "the same step again, a recap, more detail or exact figures for a step already there, " +
        "or comment on one. other: anything else, including news about the same company, " +
        "person or field that is not that matter. When in doubt, it is not a move.",
      "- moves: one per development, under the follow it moves, citing every story of kind " +
        "move that reports it. No moves is a fine answer.",
      "- A move's text: what happened, in one plain sentence of at most 25 words, with the " +
        "names and numbers the stories give. Only what the stories say. No em-dashes.",
    ].join("\n"),
    user: items
      .map((i) =>
        [
          `${i.id}: ${i.follow.headline}`,
          ...i.follow.points.map((p) => `  ${readerDay(Date.parse(p.at), timeZone)} | ${p.text}`),
          "  New stories:",
          ...i.stories.map((s) =>
            [
              `  ${s.id}`,
              readerDay(Date.parse(s.story.receivedAt), timeZone),
              s.publication,
              `${s.story.headline}. ${s.story.summary}`,
              s.story.names.join(", ") || "-",
            ].join(" | "),
          ),
        ].join("\n"),
      )
      .join("\n\n"),
    tool: {
      name: "record_moves",
      description: "Record the real developments of the followed stories.",
      schema: {
        type: "object",
        properties: {
          matters: {
            type: "array",
            items: {
              type: "object",
              properties: { follow: { type: "string" }, matter: { type: "string" } },
              required: ["follow", "matter"],
            },
          },
          stories: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                kind: { type: "string", enum: [...KINDS] },
              },
              required: ["id", "kind"],
            },
          },
          moves: {
            type: "array",
            items: {
              type: "object",
              properties: {
                follow: { type: "string" },
                text: { type: "string", description: "One sentence, at most 25 words." },
                stories: { type: "array", items: { type: "string" }, minItems: 1 },
              },
              required: ["follow", "text", "stories"],
            },
          },
        },
        required: ["matters", "stories", "moves"],
      },
    },
    maxTokens: 1500,
  };
}

const clean = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        .replace(/\s*—\s*/g, ", ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/**
 * Claude's moves, checked: a move needs text and at least one story sent under its own follow
 * that Claude also called a move. Its date is its earliest story's, its sources its stories'
 * issues. Keyed by follow id.
 */
export function parseMoves(
  input: unknown,
  items: MoveItem[],
  added: string,
): Map<string, FollowPoint[]> {
  const o = (input ?? {}) as { stories?: unknown; moves?: unknown };
  const out = new Map<string, FollowPoint[]>();
  if (!Array.isArray(o.moves)) return out;
  const moving = new Set(
    (Array.isArray(o.stories) ? o.stories : []).flatMap((v) => {
      const r = (v ?? {}) as Record<string, unknown>;
      return r.kind === "move" ? [String(r.id).trim()] : [];
    }),
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const m of o.moves) {
    const r = (m ?? {}) as Record<string, unknown>;
    const item = byId.get(String(r.follow).trim());
    const text = clean(r.text, 300);
    if (!item || !text) continue;
    const ids = new Set((Array.isArray(r.stories) ? r.stories : []).map((s) => String(s).trim()));
    const used = item.stories
      .filter((s) => ids.has(s.id) && moving.has(s.id))
      .sort((a, b) => a.story.receivedAt.localeCompare(b.story.receivedAt));
    if (!used.length) continue;
    const sources = new Map<string, TimelineSource>();
    for (const s of used) {
      if (sources.has(s.story.issueId)) continue;
      sources.set(s.story.issueId, {
        issueId: s.story.issueId,
        publication: s.publication,
        ...(s.digest ? { story: { n: s.story.n, headline: s.story.headline } } : {}),
      });
    }
    out.set(item.id, [
      ...(out.get(item.id) ?? []),
      { at: used[0]!.story.receivedAt, text, sources: [...sources.values()], added },
    ]);
  }
  return out;
}

/**
 * The check after each ingest: candidates for every followed story that is not quiet, one call
 * for all of them, then each follow's moves and checked stories written back. A follow
 * unfollowed in the meantime is left alone.
 */
export async function checkFollows(
  store: Pick<
    Store,
    | "follows"
    | "recentStories"
    | "senderSettings"
    | "storyVectors"
    | "issueBriefs"
    | "addMoves"
    | "settings"
  >,
  model: ModelPort,
  opts: { now?: number } = {},
): Promise<FollowStats> {
  const started = Date.now();
  const now = opts.now ?? started;
  const stats: FollowStats = {
    follows: 0,
    candidates: 0,
    moves: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };
  const done = () => ({ ...stats, durationMs: Date.now() - started });

  const follows = (await store.follows()).filter((f) => !isQuiet(f, now));
  stats.follows = follows.length;
  if (!follows.length) return done();

  const [recent, senders, vectors] = await Promise.all([
    store.recentStories(new Date(now - FOLLOW_WINDOW_DAYS * DAY_MS).toISOString()),
    store.senderSettings(),
    store.storyVectors([...new Set(follows.flatMap(anchorRefs))]),
  ]);
  const muted = new Set([...senders].filter(([, s]) => s.muted).map(([id]) => id));
  const picked = follows.flatMap((f) => {
    const anchors = anchorRefs(f).flatMap((r) => (vectors.has(r) ? [vectors.get(r)!] : []));
    const stories = followCandidates(f, anchors, recent, muted);
    return stories.length ? [{ follow: f, stories }] : [];
  });
  if (!picked.length) return done();

  const issues = await store.issueBriefs([
    ...new Set(picked.flatMap((p) => p.stories.map((s) => s.issueId))),
  ]);
  let k = 0;
  const items: MoveItem[] = picked.map((p, i) => ({
    id: `F${i + 1}`,
    follow: p.follow,
    stories: p.stories.map((story) => ({
      id: `S${++k}`,
      story,
      publication: issues.get(story.issueId)?.publication ?? "",
      digest: (issues.get(story.issueId)?.storyCount ?? 0) > 1,
    })),
  }));
  stats.candidates = k;

  const res = await model.callTool(movesRequest(items, (await store.settings()).timeZone));
  stats.inputTokens = res.inputTokens;
  stats.outputTokens = res.outputTokens;
  const moves = parseMoves(res.input, items, new Date(now).toISOString());
  for (const item of items) {
    const found = moves.get(item.id) ?? [];
    stats.moves += found.length;
    const movedAt = found.reduce<string | undefined>(
      (at, p) => (!at || p.at > at ? p.at : at),
      item.follow.movedAt,
    );
    await store.addMoves(
      item.follow.eventId,
      found,
      [...item.follow.checked, ...item.stories.map((s) => s.story.key)].slice(-CHECKED_KEEP),
      movedAt,
    );
  }
  return done();
}
