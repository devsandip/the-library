/**
 * Takes (#17, the first layer; DEEP-03 in the redesign): how each of the reader's newsletters
 * covered the same event, side by side and grouped by where they land. The open story's event
 * (#15) across newsletters, plus stories a few days either side that read alike, one per
 * newsletter, go to Claude, which groups them under short labels with one sentence each.
 *
 * Not an agent: retrieve, group, one call of about a cent. Written only when the reader asks, and
 * kept for the event, so the same news reached from another newsletter opens free.
 */
import {
  CLAUDE_MODEL,
  claudeCents,
  closestStories,
  READER,
  READER_TIME_ZONE,
  readerDay,
  storyRef,
} from "@library/core";
import type {
  Take,
  TakeGroup,
  Takes as TakesResult,
  TakesResponse,
  TimelineSource,
} from "@library/core/types";
import type { ClaudePort, ToolRequest } from "./claude.js";
import type { Corpus, CorpusCache } from "./corpus.js";
import { notFound } from "./errors.js";
import type { TakesPort } from "./port.js";
import type { TimelineStore, TimelineStory } from "./timeline.js";

/** Stories this many days either side of the open one may be its event, when they read alike. */
export const TAKES_DAYS = 3;
/** How alike, as a cosine: the story index links on 0.55 with a shared name. */
export const TAKES_CUTOFF = 0.55;
/** Newsletters compared at most besides the open story's. */
export const TAKES_NEWSLETTERS = 8;
const MAX_GROUPS = 4;
const DAY_MS = 86_400_000;

export const onlyOne = (publication: string) =>
  `Only ${publication} carried this in your newsletters.`;

/** Where takes read from and are kept. DynamoRepo implements it; tests use a fake. */
export interface TakesStore extends Pick<
  TimelineStore,
  "timelineStory" | "listSenders" | "settings"
> {
  getTakes(eventId: string): Promise<TakesResult | undefined>;
  putTakes(eventId: string, takes: StoredTakes): Promise<void>;
}

/** Kept takes: what the app shows, and what they were written from. */
export interface StoredTakes extends TakesResult {
  from: string;
  storyKeys: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** One line of Claude's input: a newsletter's story about the event. */
export interface TakesItem {
  /** "1" and up, in date order. */
  id: string;
  issueId: string;
  n: number;
  senderId: string;
  receivedAt: string;
  publication: string;
  headline: string;
  summary: string;
  names: string[];
  digest: boolean;
  /** The story that is open. */
  reading: boolean;
}

/**
 * The open story and one story from each other newsletter that covered its event: the event's
 * own stories first (any date), then stories within a few days that read alike. Muted
 * newsletters and promos are left out (`eligible`); a newsletter's closest story stands for it.
 */
export function takesItems(
  story: TimelineStory,
  corpus: Pick<Corpus, "issues" | "storiesByKey" | "storyCount" | "candidates">,
  eligible: (issueId: string) => boolean,
): TakesItem[] {
  const near = new Map(
    closestStories(story, corpus.candidates, {
      cutoff: TAKES_CUTOFF,
      eligible: (c) =>
        Math.abs(Date.parse(c.receivedAt) - Date.parse(story.receivedAt)) <= TAKES_DAYS * DAY_MS,
    }).map((m) => [`${m.issueId}#${m.n}`, m.similarity]),
  );
  // Same event first (scored above any cosine), then the closest.
  const scored: { key: string; score: number }[] = [];
  for (const [key, s] of corpus.storiesByKey) {
    if (s.id === story.issueId) continue;
    if (s.eventId === story.eventId) scored.push({ key, score: 2 + (near.get(key) ?? 0) });
    else if (near.has(key)) scored.push({ key, score: near.get(key)! });
  }
  scored.sort((a, b) => b.score - a.score);

  const own: Omit<TakesItem, "id"> = {
    issueId: story.issueId,
    n: story.n,
    senderId: story.senderId,
    receivedAt: story.receivedAt,
    publication: story.publication,
    headline: story.headline,
    summary: story.summary,
    names: story.names,
    digest: story.digest,
    reading: true,
  };
  const seen = new Set([story.senderId]);
  const others: Omit<TakesItem, "id">[] = [];
  for (const { key } of scored) {
    if (others.length >= TAKES_NEWSLETTERS) break;
    const s = corpus.storiesByKey.get(key)!;
    const issue = corpus.issues.get(s.id);
    if (!issue || seen.has(issue.senderId) || !eligible(s.id)) continue;
    seen.add(issue.senderId);
    others.push({
      issueId: s.id,
      n: s.n,
      senderId: issue.senderId,
      receivedAt: issue.receivedAt,
      publication: issue.publication,
      headline: s.headline,
      summary: s.summary,
      names: s.names,
      digest: (corpus.storyCount.get(s.id) ?? 0) > 1,
      reading: false,
    });
  }
  return [own, ...others]
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    .map((i, k) => ({ id: String(k + 1), ...i }));
}

export function takesRequest(
  items: TakesItem[],
  timeZone = READER_TIME_ZONE,
  about = READER,
): ToolRequest {
  return {
    system: [
      `You compare how one reader's newsletters covered the same news. ${about}`,
      "",
      "The user sends one story per newsletter, oldest first, one per line: an id, the date, the " +
        "newsletter, the headline and summary, and the names involved. The line marked READING " +
        "is the story the reader has open. The others were picked because they are about the " +
        "same event or read alike, and some may be about something else.",
      "Call group_takes:",
      `- groups: one to ${MAX_GROUPS} groups of newsletters that land in the same place, each ` +
        'under a label of two to five words for where they land ("Sees a threat", "Skeptical ' +
        'of the numbers", "Just the facts"). Each newsletter goes in one group, with one plain ' +
        "sentence of at most 25 words on what it says or stresses that the others do not, and " +
        "its id. The READING story is always in a group.",
      "- Leave out every story that is not about the READING story's event: other news about the " +
        "same company, person or field. When in doubt, leave it out.",
      "- gist: where the newsletters agree and where they differ, in one plain sentence of at " +
        "most 30 words.",
      "- Only what the stories say: no outside knowledge, no judging who is right. No em-dashes.",
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
      name: "group_takes",
      description: "Record how the newsletters' takes on this event group.",
      schema: {
        type: "object",
        properties: {
          groups: {
            type: "array",
            minItems: 1,
            maxItems: MAX_GROUPS,
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Two to five words." },
                takes: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    properties: {
                      text: { type: "string", description: "One sentence, at most 25 words." },
                      story: { type: "string" },
                    },
                    required: ["text", "story"],
                  },
                },
              },
              required: ["label", "takes"],
            },
          },
          gist: { type: "string", description: "One sentence, at most 30 words." },
        },
        required: ["groups", "gist"],
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
 * Claude's tool input, checked. A take needs text and a story it was sent; each newsletter counts
 * once, in the first group that has it; a group with no takes left is dropped. Fewer than two
 * newsletters left is nothing to compare: undefined.
 */
export function parseTakes(
  input: unknown,
  items: TakesItem[],
): { gist: string; groups: TakeGroup[] } | undefined {
  const o = (input ?? {}) as { groups?: unknown; gist?: unknown };
  if (!Array.isArray(o.groups)) return undefined;
  const byId = new Map(items.map((i) => [i.id, i]));
  const placed = new Set<string>();
  const groups = o.groups.slice(0, MAX_GROUPS).flatMap((g): TakeGroup[] => {
    const r = (g ?? {}) as Record<string, unknown>;
    const label = clean(r.label, 60);
    const takes = (Array.isArray(r.takes) ? r.takes : []).flatMap((t): Take[] => {
      const x = (t ?? {}) as Record<string, unknown>;
      const item = byId.get(String(x.story ?? "").trim());
      const text = clean(x.text, 300);
      if (!item || !text || placed.has(item.senderId)) return [];
      placed.add(item.senderId);
      const source: TimelineSource = {
        issueId: item.issueId,
        publication: item.publication,
        ...(item.digest ? { story: { n: item.n, headline: item.headline } } : {}),
      };
      return [{ text, source, ...(item.reading ? { current: true as const } : {}) }];
    });
    return label && takes.length ? [{ label, takes }] : [];
  });
  if (placed.size < 2) return undefined;
  return { gist: clean(o.gist, 400), groups };
}

export class Takes implements TakesPort {
  constructor(
    private readonly store: TakesStore,
    private readonly corpus: CorpusCache,
    private readonly claude: ClaudePort,
    private readonly now: () => number = Date.now,
  ) {}

  private async story(id: string, n: number): Promise<TimelineStory> {
    const story = await this.store.timelineStory(id, n);
    if (!story) throw notFound(`issue ${id} has no story ${n}`);
    return story;
  }

  async get(id: string, n: number): Promise<TakesResponse> {
    const takes = await this.store.getTakes((await this.story(id, n)).eventId);
    return takes ? { takes } : {};
  }

  async run(id: string, n: number): Promise<TakesResponse> {
    const started = this.now();
    const story = await this.story(id, n);
    const [corpus, senders] = await Promise.all([this.corpus.load(), this.store.listSenders()]);
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const eligible = (issueId: string) => {
      const issue = corpus.issues.get(issueId);
      return issue !== undefined && !muted.has(issue.senderId);
    };
    const items = takesItems(story, corpus, eligible);
    if (items.length < 2) return { none: onlyOne(story.publication) };

    const settings = await this.store.settings();
    const res = await this.claude.callTool(takesRequest(items, settings.timeZone, settings.about));
    const parsed = parseTakes(res.input, items);
    if (!parsed) return { none: onlyOne(story.publication) };
    const takes: TakesResult = {
      ...parsed,
      at: new Date(started).toISOString(),
      newsletters: parsed.groups.reduce((n, g) => n + g.takes.length, 0),
      ms: this.now() - started,
      cents: claudeCents(res.inputTokens, res.outputTokens),
    };
    await this.store.putTakes(story.eventId, {
      ...takes,
      from: storyRef(id, n),
      storyKeys: items.map((i) => storyRef(i.issueId, i.n)),
      model: CLAUDE_MODEL,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
    });
    console.log(
      JSON.stringify({
        level: "info",
        msg: "takes written",
        story: storyRef(id, n),
        eventId: story.eventId,
        newsletters: takes.newsletters,
        groups: takes.groups.length,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        ms: takes.ms,
      }),
    );
    return { takes };
  }
}
