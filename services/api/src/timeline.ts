/**
 * How this evolved (#19): a story against the last few weeks of the reader's newsletters. The
 * story's closest stories (related stories' match, `closestStories`), from four weeks before it
 * up to now, go to Claude in date order. It keeps the ones that are part of the story's own
 * development and tells them as dated points, each linking to the issues that carried it.
 *
 * Not an agent: retrieve, sort, write, one call of about half a cent. Written only when the reader
 * asks, and kept for the story's event, so the same news reached from another newsletter opens
 * free.
 */
import type { ReaderSettings } from "@library/core/settings";
import {
  CLAUDE_MODEL,
  claudeCents,
  closestStories,
  READER,
  READER_TIME_ZONE,
  readerDay,
  storyRef,
  type StoryCandidate,
  type StoryMatch,
} from "@library/core";
import type {
  SenderListItem,
  Timeline,
  TimelinePoint,
  TimelineResponse,
  TimelineSource,
} from "@library/core/types";
import type { ClaudePort, ToolRequest } from "./claude.js";
import type { Corpus, CorpusCache } from "./corpus.js";
import { notFound } from "./errors.js";
import type { TimelinePort } from "./port.js";

/** How far back from the story a timeline looks. Everything since counts too. */
export const TIMELINE_WEEKS = 4;
/** Claude reads at most this many stories besides the story itself: the closest. */
export const TIMELINE_STORIES = 14;
const MAX_POINTS = 8;
const WEEK_MS = 7 * 86_400_000;

export const NOTHING_CLOSE = "Nothing close in your newsletters from the last four weeks.";
export const NOTHING_MOVES =
  "Nothing else in your newsletters from the last four weeks is part of this story.";

/** The story a timeline is written from: its words, its embedding, its event and its issue. */
export interface TimelineStory extends StoryCandidate {
  headline: string;
  summary: string;
  names: string[];
  /** Its event (#15); a story that started its own event has its own key. */
  eventId: string;
  publication: string;
  /** The issue holds more than one story. */
  digest: boolean;
}

/** A kept timeline: what the app shows, and what it was written from. */
export interface StoredTimeline extends Timeline {
  /** The story it was written from, and every story Claude read for it ("<issueId>#<nn>"). */
  from: string;
  storyKeys: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Where timelines read from and are kept. DynamoRepo implements it; tests use a fake. */
export interface TimelineStore {
  /** The reader's settings: the dates Claude reads are their days (#185). */
  settings(): Promise<ReaderSettings>;
  /** One story of an issue, read now; undefined when the issue has no such story. */
  timelineStory(id: string, n: number): Promise<TimelineStory | undefined>;
  getTimeline(eventId: string): Promise<Timeline | undefined>;
  putTimeline(eventId: string, timeline: StoredTimeline): Promise<void>;
  listSenders(): Promise<SenderListItem[]>;
}

/** One line of Claude's input. */
export interface TimelineItem {
  /** "1" and up, in date order. */
  id: string;
  issueId: string;
  n: number;
  receivedAt: string;
  publication: string;
  headline: string;
  summary: string;
  names: string[];
  digest: boolean;
  /** The story the timeline is written from. */
  reading: boolean;
}

/** The story and its matches as Claude reads them, oldest first and numbered from 1. */
export function timelineItems(
  story: TimelineStory,
  matches: StoryMatch[],
  corpus: Pick<Corpus, "issues" | "storiesByKey" | "storyCount">,
): TimelineItem[] {
  const own: Omit<TimelineItem, "id"> = {
    issueId: story.issueId,
    n: story.n,
    receivedAt: story.receivedAt,
    publication: story.publication,
    headline: story.headline,
    summary: story.summary,
    names: story.names,
    digest: story.digest,
    reading: true,
  };
  const others = matches.flatMap((m): Omit<TimelineItem, "id">[] => {
    const s = corpus.storiesByKey.get(`${m.issueId}#${m.n}`);
    const issue = corpus.issues.get(m.issueId);
    if (!s || !issue) return [];
    return [
      {
        issueId: m.issueId,
        n: m.n,
        receivedAt: issue.receivedAt,
        publication: issue.publication,
        headline: s.headline,
        summary: s.summary,
        names: s.names,
        digest: (corpus.storyCount.get(m.issueId) ?? 0) > 1,
        reading: false,
      },
    ];
  });
  return [own, ...others]
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    .map((i, k) => ({ id: String(k + 1), ...i }));
}

export function timelineRequest(
  items: TimelineItem[],
  timeZone = READER_TIME_ZONE,
  about = READER,
): ToolRequest {
  return {
    system: [
      `You tell one reader how a story developed, from the stories in their own newsletters. ${about}`,
      "",
      "The user sends stories from the reader's newsletters, oldest first, one per line: an id, " +
        "the date, the newsletter, the headline and summary, and the names involved. The line " +
        "marked READING is the story the reader has open. The others were picked because they " +
        "read alike, and some are about something else.",
      "Call write_timeline:",
      "- points: the steps in this story's own development, oldest first, at most 8. A point is " +
        "one development: what happened, in one plain sentence of at most 25 words, with the " +
        "names and numbers the stories give. Several newsletters reporting the same development " +
        "make one point, with all their ids. Exactly one point cites the READING story.",
      "- Leave out every story that is not part of this development: other news about the same " +
        "company or person, the same field, a similar product. When in doubt, leave it out. If " +
        "no other story is part of it, give only the READING story's point.",
      "- gist: how the story moved over these weeks, in one plain sentence of at most 30 words.",
      "- Only what the stories say: no outside knowledge, no predictions, no advice. No em-dashes.",
    ].join("\n"),
    user: items
      .map((i) =>
        [
          i.id,
          readerDay(Date.parse(i.receivedAt), timeZone),
          i.publication,
          `${i.headline}. ${i.summary}`,
          i.names.join(", ") || "-",
          ...(i.reading ? ["READING"] : []),
        ].join(" | "),
      )
      .join("\n"),
    tool: {
      name: "write_timeline",
      description: "Record how the story developed, as dated points.",
      schema: {
        type: "object",
        properties: {
          points: {
            type: "array",
            minItems: 1,
            maxItems: MAX_POINTS,
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "One sentence, at most 25 words." },
                stories: { type: "array", items: { type: "string" }, minItems: 1 },
              },
              required: ["text", "stories"],
            },
          },
          gist: { type: "string", description: "One sentence, at most 30 words." },
        },
        required: ["points", "gist"],
      },
    },
    maxTokens: 1200,
  };
}

/** Whitespace squeezed, and the reader's house style: no em-dashes. */
const clean = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        .replace(/\s*—\s*/g, ", ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/**
 * Claude's tool input, checked. A point needs text and at least one known story; its date is the
 * earliest of its stories, never Claude's, and the points are put in that order. If Claude cites
 * the story being read in more than one point, the latest of them is the current one.
 */
export function parseTimeline(
  input: unknown,
  items: TimelineItem[],
): { gist: string; points: TimelinePoint[] } {
  const o = (input ?? {}) as { points?: unknown; gist?: unknown };
  if (!Array.isArray(o.points)) throw new Error("no point list");
  const byId = new Map(items.map((i) => [i.id, i]));
  const points = o.points.slice(0, MAX_POINTS).flatMap((p): TimelinePoint[] => {
    const q = (p ?? {}) as Record<string, unknown>;
    const text = clean(q.text, 300);
    const used = [
      ...new Set(
        (Array.isArray(q.stories) ? q.stories : []).flatMap((id) => {
          const item = byId.get(String(id).trim());
          return item ? [item] : [];
        }),
      ),
    ].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    if (!text || !used.length) return [];
    const sources = new Map<string, TimelineSource>();
    for (const i of used) {
      if (sources.has(i.issueId)) continue;
      sources.set(i.issueId, {
        issueId: i.issueId,
        publication: i.publication,
        ...(i.digest ? { story: { n: i.n, headline: i.headline } } : {}),
      });
    }
    return [
      {
        at: used[0]!.receivedAt,
        text,
        sources: [...sources.values()],
        ...(used.some((i) => i.reading) ? { current: true as const } : {}),
      },
    ];
  });
  points.sort((a, b) => a.at.localeCompare(b.at));
  const current = points.findLastIndex((p) => p.current);
  return {
    gist: clean(o.gist, 400),
    points: points.map((p, k) => {
      if (!p.current || k === current) return p;
      const { current: _, ...rest } = p;
      return rest;
    }),
  };
}

export class Timelines implements TimelinePort {
  constructor(
    private readonly store: TimelineStore,
    private readonly corpus: CorpusCache,
    private readonly claude: ClaudePort,
    private readonly now: () => number = Date.now,
  ) {}

  private async story(id: string, n: number): Promise<TimelineStory> {
    const story = await this.store.timelineStory(id, n);
    if (!story) throw notFound(`issue ${id} has no story ${n}`);
    return story;
  }

  async get(id: string, n: number): Promise<TimelineResponse> {
    const timeline = await this.store.getTimeline((await this.story(id, n)).eventId);
    return timeline ? { timeline } : {};
  }

  async run(id: string, n: number): Promise<TimelineResponse> {
    const started = this.now();
    const story = await this.story(id, n);
    const [corpus, senders] = await Promise.all([this.corpus.load(), this.store.listSenders()]);
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const from = new Date(Date.parse(story.receivedAt) - TIMELINE_WEEKS * WEEK_MS).toISOString();
    const matches = closestStories(story, corpus.candidates, {
      eligible: (c) => c.receivedAt >= from && !muted.has(c.senderId),
    }).slice(0, TIMELINE_STORIES);
    if (!matches.length) return { none: NOTHING_CLOSE };

    const items = timelineItems(story, matches, corpus);
    const settings = await this.store.settings();
    const res = await this.claude.callTool(
      timelineRequest(items, settings.timeZone, settings.about),
    );
    const { gist, points } = parseTimeline(res.input, items);
    if (points.length < 2) return { none: NOTHING_MOVES };
    const timeline: Timeline = {
      gist,
      points,
      at: new Date(started).toISOString(),
      stories: items.length,
      ms: this.now() - started,
      cents: claudeCents(res.inputTokens, res.outputTokens),
    };
    await this.store.putTimeline(story.eventId, {
      ...timeline,
      from: storyRef(id, n),
      storyKeys: items.map((i) => storyRef(i.issueId, i.n)),
      model: CLAUDE_MODEL,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
    });
    console.log(
      JSON.stringify({
        level: "info",
        msg: "timeline written",
        story: storyRef(id, n),
        eventId: story.eventId,
        stories: items.length,
        points: points.length,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        ms: timeline.ms,
      }),
    );
    return { timeline };
  }
}
