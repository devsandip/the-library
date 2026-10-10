/**
 * Enrichment: Claude reads each stored issue once and returns a one-line summary, its shelf (News
 * or Learning), one topic from the topic list, and how much of it is selling (a promo is archived).
 * Titan adds an embedding
 * for Phase 2 ranking. Runs after every ingest for new issues (retrying recent failures) and on
 * demand for the backlog (`pnpm enrich`). The topic list is proposed once (`pnpm topics`).
 */
import { INTERESTS } from "@library/core";
import type { EnrichStats, Shelf, ShelfSetBy, Topic } from "@library/core/types";
import type { ModelPort, ToolRequest } from "./bedrock.js";
import { mapLimit } from "./ingest.js";
import type { Store } from "./store.js";

export const READER =
  "The reader is a senior product manager interested in the tech industry, startups, AI, " +
  "product management and system design, plus some general business news.";

/** How much of an issue Claude reads: roughly the first 1,500 tokens. */
const MAX_TEXT_CHARS = 6000;

/** Newsletters pad their preview text with invisible characters; drop them before cutting. */
export function compactText(text: string): string {
  return text
    .replace(/[\u034f\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Three answers rather than yes/no: asked "is this a promo?", Haiku flagged most issues that merely
 * carry a sponsor slot (158 of 396 on the first backlog run). Only "promo" is archived.
 */
export const SELLING = ["none", "ad-supported", "promo"] as const;
export type Selling = (typeof SELLING)[number];

export interface Classification {
  summary: string;
  shelf: Shelf;
  topic: string;
  selling: Selling;
  /** selling === "promo" */
  promo: boolean;
}

export function classifyRequest(
  issue: { publication: string; subject: string; text: string },
  topics: Topic[],
): ToolRequest {
  return {
    system: [
      `You sort newsletter issues for one reader. ${READER}`,
      "",
      "Call classify_issue for the issue the user sends:",
      "- summary: one plain sentence of at most 25 words on what the issue covers. Specific, no " +
        'hype. Do not start with "This issue" or the newsletter\'s name.',
      '- shelf: "news" if its value fades within weeks: what happened, launches, funding and ' +
        "deals, markets, politics, this week's links and quick takes. A digest of links is news. " +
        '"learning" if it would still be worth reading in three months: explanations, deep ' +
        "dives, how-tos, frameworks, case studies, interviews about craft, essays.",
      "- topic: the one topic below that fits best.",
      "- selling: how much of the issue is selling something.",
      '  "promo": the whole issue exists to sell: a subscription or upgrade offer, a course or ' +
        "cohort enrollment, an event or webinar invite, a launch of the sender's own paid " +
        "product, or a post marked sponsored. Nothing else of substance is in it.",
      '  "ad-supported": a normal issue (news, analysis, a tutorial, an essay, a list of links, ' +
        "practice questions) that also carries sponsor slots, ads or a plug for the sender's " +
        "course. Most newsletters are this.",
      '  "none": no ads at all.',
      '  When unsure between "promo" and "ad-supported", answer "ad-supported".',
      "",
      "Topics:",
      ...topics.map((t) => `- ${t.name}: ${t.description}`),
    ].join("\n"),
    user: `Newsletter: ${issue.publication}\nSubject: ${issue.subject}\n\n${compactText(issue.text).slice(0, MAX_TEXT_CHARS)}`,
    tool: {
      name: "classify_issue",
      description: "Record how this newsletter issue is sorted for the reader.",
      schema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "One sentence, at most 25 words." },
          shelf: { type: "string", enum: ["news", "learning"] },
          topic: { type: "string", enum: topics.map((t) => t.name) },
          selling: { type: "string", enum: [...SELLING] },
        },
        required: ["summary", "shelf", "topic", "selling"],
      },
    },
    maxTokens: 300,
  };
}

/** Claude's tool input, checked: anything off is an error, retried on the next run. */
export function parseClassification(input: unknown, topics: Topic[]): Classification {
  const o = (input ?? {}) as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? o.summary.replace(/\s+/g, " ").trim() : "";
  if (!summary) throw new Error("classification has no summary");
  if (o.shelf !== "news" && o.shelf !== "learning")
    throw new Error(`bad shelf: ${String(o.shelf)}`);
  const asked = String(o.topic).toLowerCase();
  const topic = topics.find((t) => t.name.toLowerCase() === asked)?.name;
  if (!topic) throw new Error(`unknown topic: ${String(o.topic)}`);
  const selling = SELLING.find((s) => s === o.selling);
  if (!selling) throw new Error(`bad selling: ${String(o.selling)}`);
  return {
    summary: summary.slice(0, 300),
    shelf: o.shelf,
    topic,
    selling,
    promo: selling === "promo",
  };
}

export function topicsRequest(issues: { publication: string; subject: string }[]): ToolRequest {
  return {
    system: [
      `You design a short topic list for one reader's newsletters. ${READER}`,
      "The user sends one line per issue: the newsletter's name, then the subject.",
      "Call propose_topics with 6 to 9 topics that group these issues by subject matter. Group " +
        "by subject, not by format: whether an issue is news or a deep dive is tracked " +
        'separately, so never use topics like "News" or "Deep dives".',
      "Shape the list around the reader's interests: each interest that appears in the issues " +
        "gets its own topic, and product management and system design are separate topics " +
        "(never fold product management into engineering). Do not split one area into several " +
        "topics just because it has many issues: AI gets at most two.",
      "Each topic has a short name (one to three words) and a one-line description of what " +
        "belongs in it. Together the topics should cover every issue; add a broad catch-all only " +
        "if some issues fit nowhere else.",
    ].join("\n"),
    user: issues.map((i) => `${i.publication} | ${i.subject}`).join("\n"),
    tool: {
      name: "propose_topics",
      description: "Record the proposed topic list.",
      schema: {
        type: "object",
        properties: {
          topics: {
            type: "array",
            minItems: 6,
            maxItems: 9,
            items: {
              type: "object",
              properties: { name: { type: "string" }, description: { type: "string" } },
              required: ["name", "description"],
            },
          },
        },
        required: ["topics"],
      },
    },
    maxTokens: 1500,
  };
}

export function parseTopics(input: unknown): Topic[] {
  const list = ((input ?? {}) as { topics?: unknown }).topics;
  if (!Array.isArray(list)) throw new Error("no topic list");
  const topics = list
    .map((t) => {
      const o = (t ?? {}) as Record<string, unknown>;
      return { name: String(o.name ?? "").trim(), description: String(o.description ?? "").trim() };
    })
    .filter((t) => t.name && t.description);
  const distinct = new Set(topics.map((t) => t.name.toLowerCase())).size;
  if (topics.length < 4 || topics.length > 12 || distinct !== topics.length) {
    throw new Error(`unusable topic list (${topics.length} topics, ${distinct} distinct)`);
  }
  // The API takes several topics as one comma-separated parameter.
  const comma = topics.find((t) => t.name.includes(","));
  if (comma) throw new Error(`topic names cannot contain commas: "${comma.name}"`);
  return topics;
}

/**
 * The five interests seed ranking's taste profile (packages/core/src/rank.ts). Embed them once,
 * and again whenever the list changes. Returns the embedding tokens spent (0 when up to date).
 */
export async function ensureInterests(store: Store, model: ModelPort): Promise<number> {
  const stored = await store.getInterests();
  const same =
    stored?.length === INTERESTS.length &&
    INTERESTS.every((i, n) => stored[n]?.name === i.name && stored[n]?.text === i.text);
  if (same) return 0;
  let tokens = 0;
  const out: { name: string; text: string; vector: number[] }[] = [];
  for (const i of INTERESTS) {
    const e = await model.embed(i.text);
    tokens += e.tokens;
    out.push({ ...i, vector: e.vector });
  }
  await store.putInterests(out);
  return tokens;
}

export function embeddingInput(i: {
  publication: string;
  subject: string;
  summary?: string;
  text: string;
}): string {
  return [i.publication, i.subject, i.summary, compactText(i.text)]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8000);
}

/** A stored issue as enrichment sees it. */
export interface EnrichCandidate {
  id: string;
  senderId: string;
  publication: string;
  subject: string;
  receivedAt: string;
  summary?: string;
  shelfSetBy?: ShelfSetBy;
  enriched: boolean;
  embedded: boolean;
  /** Claude marked it as a promo. */
  promo?: boolean;
  /** Split into stories (#15). */
  storied?: boolean;
  /** Failed story splits so far; after a few the issue is left alone. */
  storyAttempts?: number;
}

export interface EnrichOptions {
  sinceIso: string;
  /** Redo issues that are already enriched (after a topic or prompt change). */
  force?: boolean;
  concurrency?: number;
  /** Epoch ms after which no new issue is started; the rest wait for the next run. */
  deadline?: number;
}

export async function enrich(
  store: Store,
  model: ModelPort,
  opts: EnrichOptions,
): Promise<EnrichStats> {
  const started = Date.now();
  const [candidates, topics, senders] = await Promise.all([
    store.enrichCandidates(opts.sinceIso),
    store.getTopics(),
    store.senderSettings(),
  ]);
  const todo = candidates.filter((c) => opts.force || !c.enriched || !c.embedded);
  const stats: EnrichStats = {
    checked: todo.length,
    classified: 0,
    embedded: 0,
    promosArchived: 0,
    oldNewsArchived: 0,
    waitingForTopics: 0,
    deferred: 0,
    errors: 0,
    errorSamples: [],
    inputTokens: 0,
    outputTokens: 0,
    embedTokens: 0,
    durationMs: 0,
  };

  try {
    stats.embedTokens += await ensureInterests(store, model);
  } catch (err) {
    // Ranking falls back to ratings alone; the issues still get enriched.
    stats.errors++;
    stats.errorSamples.push(`interests: ${(err as Error).message}`);
  }

  await mapLimit(todo, opts.concurrency ?? 3, async (issue) => {
    if (opts.deadline && Date.now() > opts.deadline) {
      stats.deferred++;
      return;
    }
    try {
      const text = (await store.getText(issue.id)) ?? "";
      let summary = issue.summary;
      if (opts.force || !issue.enriched) {
        if (!topics?.length) {
          stats.waitingForTopics++;
        } else {
          const res = await model.callTool(classifyRequest({ ...issue, text }, topics));
          stats.inputTokens += res.inputTokens;
          stats.outputTokens += res.outputTokens;
          const c = parseClassification(res.input, topics);
          await store.putClassification(issue.id, c, senders.get(issue.senderId)?.shelf);
          summary = c.summary;
          stats.classified++;
          if (c.promo && (await store.autoArchive(issue.id, "promo"))) stats.promosArchived++;
        }
      }
      if (opts.force || !issue.embedded) {
        const e = await model.embed(embeddingInput({ ...issue, summary, text }));
        stats.embedTokens += e.tokens;
        await store.putEmbedding(issue.id, e.vector);
        stats.embedded++;
      }
    } catch (err) {
      stats.errors++;
      if (stats.errorSamples.length < 5) {
        stats.errorSamples.push(`${issue.id}: ${(err as Error).message}`);
      }
      console.error(
        JSON.stringify({ level: "error", msg: "enrich failed", id: issue.id, error: String(err) }),
      );
    }
  });
  stats.durationMs = Date.now() - started;
  return stats;
}

/** News goes stale: archive unread news over a week old, except from Must Read newsletters. */
export async function archiveOldNews(
  store: Store,
  opts: { now?: number; days?: number } = {},
): Promise<number> {
  const cutoff = new Date((opts.now ?? Date.now()) - (opts.days ?? 7) * 86_400_000).toISOString();
  const [stale, senders] = await Promise.all([
    store.unreadNewsBefore(cutoff),
    store.senderSettings(),
  ]);
  let archived = 0;
  for (const issue of stale) {
    if (senders.get(issue.senderId)?.mustRead) continue;
    if (await store.autoArchive(issue.id, "old-news")) archived++;
  }
  return archived;
}

export interface TopicProposal {
  issues: number;
  topics: Topic[];
  applied: boolean;
  /** Topics already stored; applying again needs `replace`, then `pnpm enrich --force`. */
  existing?: Topic[];
}

/** Claude proposes the topic list from the stored issues; stored only with `apply`. */
export async function proposeTopics(
  store: Store,
  model: ModelPort,
  opts: { sinceIso: string; apply: boolean; replace?: boolean },
): Promise<TopicProposal> {
  const [issues, existing] = await Promise.all([
    store.enrichCandidates(opts.sinceIso),
    store.getTopics(),
  ]);
  if (!issues.length) throw new Error("no stored issues to propose topics from");
  const res = await model.callTool(topicsRequest(issues));
  const topics = parseTopics(res.input);
  const apply = opts.apply && (!existing?.length || opts.replace === true);
  if (apply) await store.putTopics(topics);
  return { issues: issues.length, topics, applied: apply, existing };
}
