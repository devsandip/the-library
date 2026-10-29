/**
 * The story index (#15). Claude splits each issue into its stories (a digest holds 10 to 15, an
 * essay is one), Titan embeds each story, and stories about the same event share an event id
 * across newsletters (packages/core/src/stories.ts). A separate call from classification: it
 * reads the whole issue, with its links numbered so each story keeps its source.
 */
import {
  EVENT_WINDOW_DAYS,
  eventFor,
  linkEvents,
  READER,
  storyRef,
  storyText,
  type EventCandidate,
  byReader,
  READER_MOVE,
} from "@library/core";
import type { Shelf, StoryState, StoryStats } from "@library/core/types";
import type { ModelPort, ToolRequest } from "./bedrock.js";
import type { EnrichCandidate } from "./enrich.js";
import type { Store } from "./store.js";

/** About 15,000 tokens. On prod (2026-10-10) the longest issue was 47,600 characters. */
const MAX_STORY_CHARS = 60_000;
/** At most this many stories per issue; the tool schema says so too. */
const MAX_STORIES = 25;
/** An issue whose split failed this many times is left alone: each try costs a call. */
const MAX_ATTEMPTS = 3;

export interface ParsedStory {
  headline: string;
  summary: string;
  names: string[];
  link?: string;
}

/** A story ready to store: numbered from 1, embedded and linked. */
export interface NewStory extends ParsedStory {
  n: number;
  vector: number[];
  eventId: string;
}

/** What a story carries from before a re-split (#98): the reader's move, and its own read state. */
export interface Carried {
  shelf?: Shelf;
  shelfSetBy?: typeof READER_MOVE;
  state?: Exclude<StoryState, "unread">;
}

/** An issue's story as it was before a re-split, with what Sandip did to it. */
export interface OldStory {
  link?: string;
  headline: string;
  shelf?: Shelf;
  shelfSetBy?: string;
  state?: StoryState;
}

const sameWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * What a new story keeps from the issue's old stories when a forced re-split replaces them: the
 * old story with the same link, or else the same headline, gives its move and its read state.
 * Jev reads every new story again; a carried move still beats it.
 */
export function carriedOver(s: ParsedStory, old: OldStory[]): Carried {
  const match =
    (s.link ? old.find((o) => o.link === s.link) : undefined) ??
    old.find((o) => sameWords(o.headline) === sameWords(s.headline));
  if (!match) return {};
  return {
    ...(byReader(match.shelfSetBy) && match.shelf
      ? { shelf: match.shelf, shelfSetBy: READER_MOVE }
      : {}),
    ...(match.state === "read" || match.state === "archived" ? { state: match.state } : {}),
  };
}

/** A stored story as linking reads it. */
export interface StoredStory extends EventCandidate {
  n: number;
  senderId: string;
}

export function storiesRequest(
  issue: { publication: string; subject: string },
  text: string,
  about = READER,
): ToolRequest {
  return {
    system: [
      `You split one newsletter issue into its stories, for an index that follows news across ` +
        `newsletters. ${about}`,
      "",
      "Call record_stories with the stories in the issue, in the order they appear:",
      "- A story is one news item, announcement, argument or piece of analysis about one " +
        "subject. A digest of links holds many stories; an essay, interview or tutorial about " +
        "one subject is one story.",
      "- Leave out ads and sponsor slots, and the newsletter's own housekeeping: welcome notes, " +
        "referral programs, job boards, polls, events it runs, links to its own past issues.",
      "- headline: what happened or what the piece argues, plain, at most 12 words.",
      "- summary: one or two sentences, at most 45 words, with the specifics: who, what, numbers.",
      "- names: the companies, people, products and organisations the story is about, as they " +
        "are usually written (OpenAI, Sam Altman, GPT-5). At most 6; leave out names only " +
        "mentioned in passing.",
      "- link: links in the text are marked [n]. The number of the link to the story's own " +
        "source (the article, announcement, paper or post it describes), or 0 if it has none. " +
        "Never a sponsor's link or a share or subscribe link.",
    ].join("\n"),
    user: `Newsletter: ${issue.publication}\nSubject: ${issue.subject}\n\n${text.slice(0, MAX_STORY_CHARS)}`,
    tool: {
      name: "record_stories",
      description: "Record the stories in this newsletter issue.",
      schema: {
        type: "object",
        properties: {
          stories: {
            type: "array",
            minItems: 1,
            maxItems: MAX_STORIES,
            items: {
              type: "object",
              properties: {
                headline: { type: "string", description: "At most 12 words." },
                summary: { type: "string", description: "One or two sentences, at most 45 words." },
                names: { type: "array", items: { type: "string" }, maxItems: 6 },
                link: { type: "integer", description: "The [n] of the story's own source, or 0." },
              },
              required: ["headline", "summary", "names", "link"],
            },
          },
        },
        required: ["stories"],
      },
    },
    maxTokens: 4000,
  };
}

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Claude's tool input, checked. Stories without a headline or summary are dropped. */
export function parseStories(input: unknown, links: string[]): ParsedStory[] {
  const list = ((input ?? {}) as { stories?: unknown }).stories;
  if (!Array.isArray(list)) throw new Error("no story list");
  const stories = list.slice(0, MAX_STORIES).flatMap((item): ParsedStory[] => {
    const o = (item ?? {}) as Record<string, unknown>;
    const headline = clean(o.headline, 200);
    const summary = clean(o.summary, 600);
    if (!headline || !summary) return [];
    const names: string[] = [];
    for (const raw of Array.isArray(o.names) ? o.names : []) {
      const name = clean(raw, 80);
      if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
    }
    const ref = Number(o.link);
    const link = Number.isInteger(ref) && ref >= 1 ? links[ref - 1] : undefined;
    return [{ headline, summary, names: names.slice(0, 8), ...(link ? { link } : {}) }];
  });
  if (!stories.length) throw new Error("no usable stories");
  return stories;
}

/** What Titan embeds: no newsletter name, so stories match on what they say. */
export function storyEmbeddingInput(s: ParsedStory): string {
  return [s.headline, s.summary, s.names.join(", ")].filter(Boolean).join("\n\n");
}

const shiftDays = (iso: string, days: number) =>
  new Date(Date.parse(iso) + days * 86_400_000).toISOString();

export interface StoryOptions {
  sinceIso: string;
  /** Split issues again even if they have stories (after a prompt change). */
  force?: boolean;
  concurrency?: number;
  /** Epoch ms after which no new issue is started; the rest wait for the next run. */
  deadline?: number;
}

/**
 * Split, embed and link the issues received since `sinceIso` that have no stories yet. Promos
 * have none, and muted newsletters stay out of everything built on stories. Issues go oldest
 * first, so a story can join an event started by an earlier one.
 */
export async function indexStories(
  store: Store,
  model: ModelPort,
  opts: StoryOptions,
): Promise<StoryStats> {
  const { about } = await store.settings();
  const started = Date.now();
  const stats: StoryStats = {
    checked: 0,
    storied: 0,
    stories: 0,
    linked: 0,
    deferred: 0,
    errors: 0,
    errorSamples: [],
    inputTokens: 0,
    outputTokens: 0,
    embedTokens: 0,
    durationMs: 0,
  };
  const fail = (id: string, err: unknown) => {
    stats.errors++;
    if (stats.errorSamples.length < 5) stats.errorSamples.push(`${id}: ${(err as Error).message}`);
    console.error(
      JSON.stringify({ level: "error", msg: "stories failed", id, error: String(err) }),
    );
  };

  const split = async (issue: EnrichCandidate) => {
    const html = await store.getHtml(issue.id);
    const { text, links } = html
      ? storyText(html)
      : { text: (await store.getText(issue.id)) ?? "", links: [] };
    if (!text.trim()) throw new Error("no text");
    const res = await model.callTool(storiesRequest(issue, text, about));
    stats.inputTokens += res.inputTokens;
    stats.outputTokens += res.outputTokens;
    const out: (ParsedStory & { vector: number[] })[] = [];
    for (const s of parseStories(res.input, links)) {
      const e = await model.embed(storyEmbeddingInput(s));
      stats.embedTokens += e.tokens;
      out.push({ ...s, vector: e.vector });
    }
    return out;
  };

  const [candidates, senders] = await Promise.all([
    store.enrichCandidates(opts.sinceIso),
    store.senderSettings(),
  ]);
  const todo = candidates
    .filter((c) => !c.promo && !senders.get(c.senderId)?.muted)
    .filter((c) => opts.force || (!c.storied && (c.storyAttempts ?? 0) < MAX_ATTEMPTS))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
  stats.checked = todo.length;

  if (todo.length) {
    const linked: EventCandidate[] = await store.storiesBetween(
      shiftDays(todo[0]!.receivedAt, -EVENT_WINDOW_DAYS),
      shiftDays(todo[todo.length - 1]!.receivedAt, EVENT_WINDOW_DAYS),
    );
    const size = opts.concurrency ?? 3;
    for (let i = 0; i < todo.length; i += size) {
      if (opts.deadline && Date.now() > opts.deadline) {
        stats.deferred = todo.length - i;
        break;
      }
      const batch = todo.slice(i, i + size);
      const results = await Promise.all(
        batch.map((issue) => split(issue).catch((err: unknown) => err as Error)),
      );
      // Linked and stored in arrival order, so each story can join an earlier story's event.
      for (const [k, issue] of batch.entries()) {
        const result = results[k]!;
        if (result instanceof Error) {
          fail(issue.id, result);
          await store.putStoryError(issue.id, result.message).catch(() => undefined);
          continue;
        }
        try {
          const stories = result.map((s, at): NewStory => {
            const candidate: EventCandidate = {
              key: storyRef(issue.id, at + 1),
              issueId: issue.id,
              receivedAt: issue.receivedAt,
              names: s.names,
              vector: s.vector,
            };
            const match = eventFor(candidate, linked);
            if (match.key) stats.linked++;
            linked.push({ ...candidate, eventId: match.eventId });
            return { ...s, n: at + 1, eventId: match.eventId };
          });
          await store.putStories(issue, stories);
          stats.storied++;
          stats.stories += stories.length;
        } catch (err) {
          fail(issue.id, err);
        }
      }
    }
  }
  stats.durationMs = Date.now() - started;
  return stats;
}

export interface RelinkReport {
  stories: number;
  events: number;
  /** Events with stories from more than one newsletter. */
  shared: number;
  changed: number;
}

/** Recompute every event link, after a threshold change. No model calls. */
export async function relinkStories(store: Store): Promise<RelinkReport> {
  const all = await store.storiesBetween("2000-01-01T00:00:00.000Z", "9999-12-31T23:59:59.999Z");
  const ids = linkEvents(all);
  const changed = all
    .filter((s) => ids.get(s.key) !== s.eventId)
    .map((s) => ({ issueId: s.issueId, n: s.n, eventId: ids.get(s.key)! }));
  await store.setEventIds(changed);
  const newsletters = new Map<string, Set<string>>();
  for (const s of all) {
    const id = ids.get(s.key)!;
    newsletters.set(id, (newsletters.get(id) ?? new Set()).add(s.senderId));
  }
  return {
    stories: all.length,
    events: newsletters.size,
    shared: [...newsletters.values()].filter((n) => n.size > 1).length,
    changed: changed.length,
  };
}
