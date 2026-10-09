/**
 * Enrichment: Claude reads each stored issue once and returns a one-line summary, its shelf (News
 * or Learning), one topic from the topic list, and whether it is a promo. Titan adds an embedding
 * for Phase 2 ranking. Runs after every ingest for new issues (retrying recent failures) and on
 * demand for the backlog (`pnpm enrich`). The topic list is proposed once (`pnpm topics`).
 */
import type { EnrichStats, Shelf, ShelfSetBy, Topic } from "@library/core/types";
import type { ModelPort, ToolRequest } from "./bedrock.js";
import { mapLimit } from "./ingest.js";
import type { Store } from "./store.js";

const READER =
  "The reader is a senior product manager interested in the tech industry, startups, AI, " +
  "product management and system design, plus some general business news.";

/** How much of an issue Claude reads: roughly the first 1,500 tokens. */
const MAX_TEXT_CHARS = 6000;

export interface Classification {
  summary: string;
  shelf: Shelf;
  topic: string;
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
      "- promo: true only if the issue mainly sells something: a subscription offer, a course or " +
        "cohort sale, an event or webinar invite, or sponsored content only. A normal issue that " +
        "carries an ad is not a promo.",
      "",
      "Topics:",
      ...topics.map((t) => `- ${t.name}: ${t.description}`),
    ].join("\n"),
    user: `Newsletter: ${issue.publication}\nSubject: ${issue.subject}\n\n${issue.text.slice(0, MAX_TEXT_CHARS)}`,
    tool: {
      name: "classify_issue",
      description: "Record how this newsletter issue is sorted for the reader.",
      schema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "One sentence, at most 25 words." },
          shelf: { type: "string", enum: ["news", "learning"] },
          topic: { type: "string", enum: topics.map((t) => t.name) },
          promo: { type: "boolean" },
        },
        required: ["summary", "shelf", "topic", "promo"],
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
  if (typeof o.promo !== "boolean") throw new Error("classification has no promo flag");
  return { summary: summary.slice(0, 300), shelf: o.shelf, topic, promo: o.promo };
}

export function topicsRequest(issues: { publication: string; subject: string }[]): ToolRequest {
  return {
    system: [
      `You design a short topic list for one reader's newsletters. ${READER}`,
      "The user sends one line per issue: the newsletter's name, then the subject.",
      "Call propose_topics with 6 to 9 topics that group these issues by subject matter. Group " +
        "by subject, not by format: whether an issue is news or a deep dive is tracked " +
        'separately, so never use topics like "News" or "Deep dives".',
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
  return topics;
}

export function embeddingInput(i: {
  publication: string;
  subject: string;
  summary?: string;
  text: string;
}): string {
  return [i.publication, i.subject, i.summary, i.text].filter(Boolean).join("\n\n").slice(0, 8000);
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
