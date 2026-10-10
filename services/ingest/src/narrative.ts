/**
 * Today's news as a narrative (#18). After each scheduled run, if the day's News has moved on,
 * one Claude call reads the last day's News stories (#15), already merged by event, picks what
 * matters to the reader and writes it as a few threads: a short paragraph each, with the issues
 * it came from. Not an agent: fixed steps and one call, about a cent.
 */
import type { Narrative, NarrativeStats, NarrativeThread } from "@library/core/types";
import { MODELS, type ModelPort, type ToolRequest } from "./bedrock.js";
import { READER } from "./enrich.js";
import type { Store } from "./store.js";

/** The narrative covers News stories received in the last day. */
export const NARRATIVE_WINDOW_HOURS = 24;
/** With fewer News stories than this there is no day to tell. */
const MIN_STORIES = 8;
/**
 * A new version at most this often (four a day at most, about a cent each), and only once this
 * many stories are new since the last.
 */
const REFRESH_HOURS = 6;
const MIN_NEW_STORIES = 5;
const MAX_THREADS = 6;

const HOUR_MS = 3_600_000;

/** A stored story as the narrative reads it. */
export interface StoryText {
  key: string;
  issueId: string;
  receivedAt: string;
  headline: string;
  summary: string;
  names: string[];
  eventId: string;
}

/** What the app shows, plus what the next run needs to decide on a new version. */
export interface StoredNarrative extends Narrative {
  storyKeys: string[];
  model: string;
}

/** One line of Claude's input: an event's stories, merged. */
export interface NarrativeItem {
  id: string;
  headline: string;
  summary: string;
  names: string[];
  sources: { issueId: string; publication: string }[];
}

/** Stories (oldest first) merged by event, numbered from 1 in the order the events began. */
export function narrativeItems(
  stories: StoryText[],
  publications: Map<string, string>,
): NarrativeItem[] {
  const events = new Map<string, StoryText[]>();
  for (const s of stories) events.set(s.eventId, [...(events.get(s.eventId) ?? []), s]);
  return [...events.values()].map((group, k) => {
    const issueIds = [...new Set(group.map((s) => s.issueId))];
    return {
      id: String(k + 1),
      headline: group[0]!.headline,
      summary: group[0]!.summary,
      names: [...new Set(group.flatMap((s) => s.names))].slice(0, 6),
      sources: issueIds.map((issueId) => ({
        issueId,
        publication: publications.get(issueId) ?? "",
      })),
    };
  });
}

export function narrativeRequest(items: NarrativeItem[]): ToolRequest {
  return {
    system: [
      `You write one reader's briefing on the day's news, from the stories in their newsletters. ${READER}`,
      "",
      "The user sends the last day's news stories, one per line: an id, the headline and " +
        "summary, the names involved and the newsletters that carried it. A story that several " +
        "newsletters carried appears once.",
      "Call write_narrative with 3 to 6 threads:",
      "- A thread is one development that matters to this reader: a single big story, or " +
        "several stories about the same development (the same company or fight, a cause and " +
        "its effect). Every story in a thread must be about that development. A story that " +
        "stands alone is its own thread or is left out; never pad a thread with another story.",
      "- Pick what matters most to this reader and lead with it. Most stories will be left out.",
      "- title: plain, at most 8 words, about the one development.",
      "- text: 2 to 4 plain sentences, at most 80 words, with the names and numbers from the " +
        "stories. Only what the stories say: no outside knowledge, no predictions, no advice. " +
        "No em-dashes.",
      "- stories: the ids of the stories the thread draws on.",
    ].join("\n"),
    user: items
      .map((i) => {
        const papers = [...new Set(i.sources.map((s) => s.publication))].join(", ");
        return `${i.id} | ${i.headline}. ${i.summary} | ${i.names.join(", ") || "-"} | ${papers}`;
      })
      .join("\n"),
    tool: {
      name: "write_narrative",
      description: "Record the day's news as threads.",
      schema: {
        type: "object",
        properties: {
          threads: {
            type: "array",
            minItems: 1,
            maxItems: MAX_THREADS,
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "At most 8 words." },
                text: { type: "string", description: "2 to 4 sentences, at most 80 words." },
                stories: { type: "array", items: { type: "string" }, minItems: 1 },
              },
              required: ["title", "text", "stories"],
            },
          },
        },
        required: ["threads"],
      },
    },
    maxTokens: 1500,
  };
}

/** Whitespace squeezed, and the reader's house style: no em-dashes. */
const clean = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        .replace(/\s*\u2014\s*/g, ", ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/** Claude's tool input, checked. A thread needs a title, text and at least one known story. */
export function parseNarrative(input: unknown, items: NarrativeItem[]): NarrativeThread[] {
  const list = ((input ?? {}) as { threads?: unknown }).threads;
  if (!Array.isArray(list)) throw new Error("no thread list");
  const byId = new Map(items.map((i) => [i.id, i]));
  const threads = list.slice(0, MAX_THREADS).flatMap((t): NarrativeThread[] => {
    const o = (t ?? {}) as Record<string, unknown>;
    const title = clean(o.title, 120);
    const text = clean(o.text, 800);
    const used = (Array.isArray(o.stories) ? o.stories : []).flatMap((id) => {
      const item = byId.get(String(id).trim());
      return item ? [item] : [];
    });
    if (!title || !text || !used.length) return [];
    const sources = new Map<string, string>();
    for (const s of used.flatMap((i) => i.sources)) {
      if (!sources.has(s.issueId)) sources.set(s.issueId, s.publication);
    }
    return [
      {
        title,
        text,
        sources: [...sources].map(([issueId, publication]) => ({ issueId, publication })),
      },
    ];
  });
  if (!threads.length) throw new Error("no usable threads");
  return threads;
}

export interface NarrativeOptions {
  now?: number;
  /** Write a new version even if the last one is recent. */
  force?: boolean;
  /** Epoch ms after which no call is started. */
  deadline?: number;
}

/**
 * Write a new narrative if the day's News has moved on: at least 4 hours since the last version
 * and 5 or more News stories it did not have. News means the issue's shelf; promos and muted
 * newsletters are left out.
 */
export async function writeNarrative(
  store: Store,
  model: ModelPort,
  opts: NarrativeOptions = {},
): Promise<NarrativeStats> {
  const started = Date.now();
  const now = opts.now ?? started;
  const stats: NarrativeStats = {
    written: false,
    stories: 0,
    threads: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };
  const done = (skipped?: string): NarrativeStats => ({
    ...stats,
    ...(skipped ? { skipped } : {}),
    durationMs: Date.now() - started,
  });

  const since = new Date(now - NARRATIVE_WINDOW_HOURS * HOUR_MS).toISOString();
  const [stories, issues, senders, latest] = await Promise.all([
    store.storyTexts(since, new Date(now).toISOString()),
    store.enrichCandidates(since),
    store.senderSettings(),
    store.getNarrative(),
  ]);
  const news = new Map(
    issues
      .filter((i) => i.shelf === "news" && !i.promo && !senders.get(i.senderId)?.muted)
      .map((i) => [i.id, i.publication]),
  );
  const today = stories.filter((s) => news.has(s.issueId));
  stats.stories = today.length;
  if (today.length < MIN_STORIES) return done("too few News stories");
  if (!opts.force && latest) {
    if (now - Date.parse(latest.at) < REFRESH_HOURS * HOUR_MS) return done("written recently");
    const seen = new Set(latest.storyKeys);
    if (today.filter((s) => !seen.has(s.key)).length < MIN_NEW_STORIES) {
      return done("little new since the last one");
    }
  }
  if (opts.deadline && Date.now() > opts.deadline) return done("out of time");

  const items = narrativeItems(today, news);
  const res = await model.callTool(narrativeRequest(items));
  stats.inputTokens = res.inputTokens;
  stats.outputTokens = res.outputTokens;
  const threads = parseNarrative(res.input, items);
  await store.putNarrative({
    at: new Date(now).toISOString(),
    threads,
    stories: today.length,
    newsletters: new Set(today.map((s) => news.get(s.issueId))).size,
    storyKeys: today.map((s) => s.key),
    model: MODELS.classify,
  });
  stats.written = true;
  stats.threads = threads.length;
  stats.titles = threads.map((t) => t.title);
  return done();
}
