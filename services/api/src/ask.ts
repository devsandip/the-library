/**
 * Ask the Library (#21): a question answered from the reader's own newsletters. Claude plans up
 * to three archive searches; each runs story by story over the corpus search keeps, by words and
 * by meaning (`searchIssues`), within a date window when the question names one. The best
 * stories go to a second call, which answers citing every story it uses, or says the newsletters
 * have nothing on it.
 *
 * Two Haiku calls of under a cent each and a few Titan embeddings, about 10 seconds, so it fits
 * the API's time limit with no background job. Nothing is kept.
 */
import type { ReaderSettings } from "@library/core/settings";
import {
  claudeCents,
  isReaderDay,
  queryTerms,
  READER,
  READER_TIME_ZONE,
  readerDay,
  readerDayBounds,
  searchIssues,
  type SearchDoc,
  type StoryVector,
} from "@library/core";
import type {
  AskParagraph,
  AskResponse,
  SenderListItem,
  TimelineSource,
} from "@library/core/types";
import type { ClaudePort, ToolRequest } from "./claude.js";
import type { Corpus, CorpusCache } from "./corpus.js";
import type { AskPort } from "./port.js";
import type { Embedder } from "./search.js";

/** Searches Claude may plan for one question. */
export const ASK_SEARCHES = 3;
/** Stories the answer is written from at most, shared between the searches. */
export const ASK_STORIES = 30;
const MAX_PARAGRAPHS = 5;

export const NOTHING_FOUND = "Nothing in your newsletters matches this.";

/** When the question's days ruled out every match: what there is, and when it last came. */
export function nothingThen(s: AskSearch, latest: string): string {
  const days =
    s.from && s.to ? `from ${s.from} to ${s.to}` : s.from ? `since ${s.from}` : `up to ${s.to}`;
  return `Nothing in your newsletters ${days}. The latest on this arrived ${latest}.`;
}

/** One archive search: words a matching story would hold, and days (YYYY-MM-DD) to keep to. */
export interface AskSearch {
  query: string;
  from?: string;
  to?: string;
}

/** Where Ask reads which newsletters are muted. DynamoRepo implements it; tests use a fake. */
export interface AskSource {
  listSenders(): Promise<SenderListItem[]>;
  /** The reader's settings: their days for "last week" and the dates Claude reads (#185). */
  settings(): Promise<ReaderSettings>;
}

/** One line of the answer's input. */
export interface AskItem {
  /** "1" and up, oldest first. */
  id: string;
  issueId: string;
  n: number;
  receivedAt: string;
  publication: string;
  headline: string;
  summary: string;
  names: string[];
  digest: boolean;
}

const day = /^\d{4}-\d{2}-\d{2}$/;

export function planRequest(q: string, today: string, about = READER): ToolRequest {
  return {
    system: [
      `You plan searches of one reader's newsletter archive to answer their question. ${about}`,
      `The archive holds about two months of their newsletters, split into stories: a headline, a ` +
        `short summary and the names involved. Today is ${today}.`,
      "",
      "Call plan_searches with one to three searches:",
      "- query: a few words a matching story would contain: the subject, the names, products " +
        'and terms. Not the question itself: leave out words like "what", "my newsletters" ' +
        'and "say".',
      "- Two or three searches only when the question has several parts, or its subject goes " +
        "by several names (an acronym and its full name). Otherwise one.",
      "- from and to: days as YYYY-MM-DD, only when the question names a time (this week, last " +
        "month, since Monday, in September). Otherwise leave them out.",
    ].join("\n"),
    user: q,
    tool: {
      name: "plan_searches",
      description: "Record the archive searches that would find stories answering the question.",
      schema: {
        type: "object",
        properties: {
          searches: {
            type: "array",
            minItems: 1,
            maxItems: ASK_SEARCHES,
            items: {
              type: "object",
              properties: {
                query: { type: "string", description: "A few words, not a sentence." },
                from: { type: "string", description: "YYYY-MM-DD, or leave it out." },
                to: { type: "string", description: "YYYY-MM-DD, or leave it out." },
              },
              required: ["query"],
            },
          },
        },
        required: ["searches"],
      },
    },
    maxTokens: 300,
  };
}

/**
 * Claude's plan, checked. A search needs words; a day that is not a real day, or after today, is
 * dropped. With nothing usable, the question itself is the one search.
 */
export function parsePlan(input: unknown, q: string, today: string): AskSearch[] {
  const o = (input ?? {}) as { searches?: unknown };
  const list = Array.isArray(o.searches) ? o.searches : [];
  const dayOrNot = (v: unknown) =>
    typeof v === "string" && day.test(v.trim()) && isReaderDay(v.trim()) && v.trim() <= today
      ? v.trim()
      : undefined;
  const searches = list.slice(0, ASK_SEARCHES).flatMap((s): AskSearch[] => {
    const r = (s ?? {}) as Record<string, unknown>;
    const query = typeof r.query === "string" ? r.query.replace(/\s+/g, " ").trim() : "";
    if (!queryTerms(query).length) return [];
    let from = dayOrNot(r.from);
    let to = dayOrNot(r.to);
    if (from && to && from > to) [from, to] = [to, from];
    return [{ query: query.slice(0, 120), ...(from ? { from } : {}), ...(to ? { to } : {}) }];
  });
  return searches.length ? searches : [{ query: q.slice(0, 120) }];
}

/** How a search reads in the answer: its words, and its dates when it has any. */
export function searchLabel(s: AskSearch): string {
  if (!s.from && !s.to) return s.query;
  return `${s.query} (${s.from ?? "…"} to ${s.to ?? "…"})`;
}

const keyOf = (issueId: string, n: number) => `${issueId}#${n}`;

/**
 * One search's stories, best first, as "<issueId>#<n>": by words and by meaning, as search ranks
 * issues, but with each story ranked on its own so a digest's stories compete separately.
 */
export function searchStories(
  search: AskSearch,
  vector: ArrayLike<number> | undefined,
  corpus: Pick<Corpus, "docs" | "stories" | "issues">,
  eligible: (issueId: string) => boolean,
  limit = ASK_STORIES,
  timeZone = READER_TIME_ZONE,
): string[] {
  const from = search.from ? readerDayBounds(search.from, timeZone).from : "";
  const to = search.to ? readerDayBounds(search.to, timeZone).to : "￿";
  const ok = (issueId: string) => {
    const at = corpus.issues.get(issueId)?.receivedAt;
    return at !== undefined && at >= from && at <= to && eligible(issueId);
  };
  const docs: SearchDoc[] = corpus.docs.flatMap((d) =>
    d.story !== undefined && ok(d.issueId) ? [{ ...d, issueId: keyOf(d.issueId, d.story) }] : [],
  );
  const stories: StoryVector[] = corpus.stories.flatMap((s) =>
    ok(s.issueId) ? [{ ...s, issueId: keyOf(s.issueId, s.n) }] : [],
  );
  return searchIssues(queryTerms(search.query), vector, { docs, stories })
    .slice(0, limit)
    .map((m) => m.issueId);
}

/** Each search's stories in turn, best first, without repeats, up to `limit`. */
export function interleave(lists: string[][], limit = ASK_STORIES): string[] {
  const out = new Set<string>();
  for (let rank = 0; out.size < limit && lists.some((l) => rank < l.length); rank++) {
    for (const l of lists) {
      const key = l[rank];
      if (key !== undefined && out.size < limit) out.add(key);
    }
  }
  return [...out];
}

/** The chosen stories as Claude reads them, oldest first and numbered from 1. */
export function askItems(
  keys: string[],
  corpus: Pick<Corpus, "issues" | "storiesByKey" | "storyCount">,
): AskItem[] {
  return keys
    .flatMap((key): Omit<AskItem, "id">[] => {
      const s = corpus.storiesByKey.get(key);
      const issue = s && corpus.issues.get(s.id);
      if (!s || !issue) return [];
      return [
        {
          issueId: s.id,
          n: s.n,
          receivedAt: issue.receivedAt,
          publication: issue.publication,
          headline: s.headline,
          summary: s.summary,
          names: s.names,
          digest: (corpus.storyCount.get(s.id) ?? 0) > 1,
        },
      ];
    })
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.n - b.n)
    .map((i, k) => ({ id: String(k + 1), ...i }));
}

export function answerRequest(
  q: string,
  items: AskItem[],
  today: string,
  timeZone = READER_TIME_ZONE,
  about = READER,
): ToolRequest {
  return {
    system: [
      `You answer one reader's question from the stories in their own newsletters. ${about} ` +
        `Today is ${today}.`,
      "",
      "The user sends the question, then stories from the reader's newsletters, oldest first, " +
        "one per line: an id, the date, the newsletter, the headline and summary, and the names " +
        "involved. They were found by searching, so some are about something else.",
      "Call answer:",
      `- paragraphs: the answer in one to ${MAX_PARAGRAPHS} short paragraphs, the most ` +
        "important first. Each says what the stories say, in plain sentences with the names, " +
        "numbers and dates they give, and lists the ids of every story it draws on. Where " +
        "newsletters disagree, say who says what.",
      "- Only what the stories say: no outside knowledge, no guesses, no advice. If the question " +
        "names a time, use only stories from then. No em-dashes.",
      "- none: if no story answers the question, give no paragraphs and say in one sentence " +
        "what the newsletters do not cover.",
    ].join("\n"),
    user: [
      `Question: ${q}`,
      "",
      ...items.map((i) =>
        [
          i.id,
          readerDay(Date.parse(i.receivedAt), timeZone),
          i.publication,
          `${i.headline}. ${i.summary}`,
          i.names.join(", ") || "-",
        ].join(" | "),
      ),
    ].join("\n"),
    tool: {
      name: "answer",
      description: "Record the answer to the reader's question, citing the stories it uses.",
      schema: {
        type: "object",
        properties: {
          paragraphs: {
            type: "array",
            maxItems: MAX_PARAGRAPHS,
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "A short paragraph." },
                stories: { type: "array", items: { type: "string" }, minItems: 1 },
              },
              required: ["text", "stories"],
            },
          },
          none: { type: "string", description: "Only when no story answers the question." },
        },
        required: ["paragraphs"],
      },
    },
    maxTokens: 1500,
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
 * Claude's answer, checked. A paragraph needs text and at least one known story; its sources are
 * those stories' issues, oldest first, with the story inside a digest. With no paragraph left,
 * the answer is Claude's `none`, or the plain one.
 */
export function parseAnswer(
  input: unknown,
  items: AskItem[],
): { paragraphs: AskParagraph[]; none?: string } {
  const o = (input ?? {}) as { paragraphs?: unknown; none?: unknown };
  const byId = new Map(items.map((i) => [i.id, i]));
  const paragraphs = (Array.isArray(o.paragraphs) ? o.paragraphs : [])
    .slice(0, MAX_PARAGRAPHS)
    .flatMap((p): AskParagraph[] => {
      const r = (p ?? {}) as Record<string, unknown>;
      const text = clean(r.text, 1200);
      const used = [
        ...new Set(
          (Array.isArray(r.stories) ? r.stories : []).flatMap((id) => {
            const item = byId.get(String(id).trim());
            return item ? [item] : [];
          }),
        ),
      ].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
      if (!text || !used.length) return [];
      const sources = new Map<string, TimelineSource>();
      for (const i of used) {
        const key = i.digest ? keyOf(i.issueId, i.n) : i.issueId;
        if (sources.has(key)) continue;
        sources.set(key, {
          issueId: i.issueId,
          publication: i.publication,
          ...(i.digest ? { story: { n: i.n, headline: i.headline } } : {}),
        });
      }
      return [{ text, sources: [...sources.values()] }];
    });
  if (paragraphs.length) return { paragraphs };
  return { paragraphs: [], none: clean(o.none, 300) || NOTHING_FOUND };
}

export class Asks implements AskPort {
  constructor(
    private readonly source: AskSource,
    private readonly corpus: CorpusCache,
    private readonly embedder: Embedder,
    private readonly claude: ClaudePort,
    private readonly now: () => number = Date.now,
  ) {}

  async ask(q: string): Promise<AskResponse> {
    const started = this.now();
    const { timeZone, about } = await this.source.settings();
    const today = readerDay(started, timeZone);
    const [corpus, senders, plan] = await Promise.all([
      this.corpus.load(),
      this.source.listSenders(),
      this.claude.callTool(planRequest(q, today, about)),
    ]);
    const searches = parsePlan(plan.input, q, today);
    const vectors = await Promise.all(searches.map((s) => this.embedder.embed(s.query)));
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const eligible = (issueId: string) => !muted.has(corpus.issues.get(issueId)?.senderId ?? "");
    // The searches share the stories: one search reads up to 30, three up to 10 each.
    const each = Math.ceil(ASK_STORIES / searches.length);
    const keys = interleave(
      searches.map((s, k) => searchStories(s, vectors[k], corpus, eligible, each, timeZone)),
    );
    const items = askItems(keys, corpus);
    let cents = claudeCents(plan.inputTokens, plan.outputTokens);
    const base = { q, searches: searches.map(searchLabel), stories: items.length };
    if (!items.length) {
      const none =
        this.latestOutside(searches, vectors, corpus, eligible, timeZone) ?? NOTHING_FOUND;
      return { ...base, paragraphs: [], none, ms: this.now() - started, cents };
    }

    const res = await this.claude.callTool(answerRequest(q, items, today, timeZone, about));
    cents = claudeCents(plan.inputTokens + res.inputTokens, plan.outputTokens + res.outputTokens);
    const answer = parseAnswer(res.input, items);
    const ms = this.now() - started;
    console.log(
      JSON.stringify({
        level: "info",
        msg: "asked",
        // Counts only: the question is the reader's own.
        searches: searches.length,
        stories: items.length,
        paragraphs: answer.paragraphs.length,
        inputTokens: plan.inputTokens + res.inputTokens,
        outputTokens: plan.outputTokens + res.outputTokens,
        ms,
      }),
    );
    return { ...base, ...answer, ms, cents };
  }

  /**
   * Nothing matched within the question's days: whether a search finds anything without them,
   * and if so when the latest of it arrived, so "last week" can say when the story last moved.
   */
  private latestOutside(
    searches: AskSearch[],
    vectors: ArrayLike<number>[],
    corpus: Corpus,
    eligible: (issueId: string) => boolean,
    timeZone: string,
  ): string | undefined {
    for (const [k, s] of searches.entries()) {
      if (!s.from && !s.to) continue;
      const days = searchStories({ query: s.query }, vectors[k], corpus, eligible).map((key) =>
        readerDay(
          Date.parse(corpus.issues.get(key.slice(0, key.lastIndexOf("#")))!.receivedAt),
          timeZone,
        ),
      );
      if (days.length) return nothingThen(s, days.sort().at(-1)!);
    }
    return undefined;
  }
}
