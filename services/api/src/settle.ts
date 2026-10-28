/**
 * Settling predictions (#24, #139): once a day the jobs Lambda takes the predictions that have
 * come due and settles each from what later newsletters report. The archive is searched story by
 * story, as Ask searches it (`searchStories`), from the day after the prediction was made; one
 * Haiku call reads what it finds and answers right, wrong or unclear, citing the stories that show
 * it. Unclear ones are tried again a fortnight later, three times in all. Sandip's own verdicts
 * are never settled again.
 */
import { claudeCents, readerDay, READER } from "@library/core";
import type {
  Prediction,
  PredictionEvidence,
  PredictionStatus,
  SenderListItem,
  SettleStats,
} from "@library/core/types";
import { askItems, searchStories, type AskItem } from "./ask.js";
import type { ClaudePort, ToolRequest } from "./claude.js";
import type { CorpusCache } from "./corpus.js";
import type { Embedder } from "./search.js";

/** Predictions settled a day at most, oldest due first; the rest wait for the next day. */
export const SETTLE_PER_DAY = 20;
/** Predictions settled at once: twenty one at a time would crowd the job's two minutes. */
const CONCURRENCY = 4;
/** Stories a prediction is settled from at most. */
const SETTLE_STORIES = 12;
/** An unclear prediction is tried this many times in all, this many days apart. */
export const SETTLE_TRIES = 3;
const RETRY_DAYS = 14;

export const NOTHING_SINCE = "Nothing in your newsletters since has mentioned it.";

/** A prediction as kept, with how often settling has tried it and when it may try again. */
export interface StoredPrediction extends Prediction {
  tries?: number;
  nextTry?: string;
}

/** The outcome of one settling, written onto the prediction. */
export interface Settlement {
  status: Exclude<PredictionStatus, "open">;
  why: string;
  evidence: PredictionEvidence[];
  settledAt: string;
  tries: number;
  /** For an unclear one with tries left: the day to try again. */
  nextTry?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** Where predictions are read and settled. DynamoRepo implements it; tests use a fake. */
export interface SettleStore {
  listPredictions(): Promise<StoredPrediction[]>;
  /** Writes the settlement unless Sandip has set a verdict since. */
  settlePrediction(id: string, s: Settlement): Promise<void>;
  listSenders(): Promise<SenderListItem[]>;
}

const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Whether a prediction is due to be settled today: due, not Sandip's, open or unclear to retry. */
export function settleable(p: StoredPrediction, today: string): boolean {
  if (p.setBy || p.due > today) return false;
  if (p.status === "open") return true;
  return p.status === "unclear" && (p.tries ?? 0) < SETTLE_TRIES && (p.nextTry ?? today) <= today;
}

export function settleRequest(p: Prediction, items: AskItem[], today: string): ToolRequest {
  return {
    system: [
      `You settle one prediction from a reader's newsletters against what their later ` +
        `newsletters report. ${READER} Today is ${today}.`,
      "",
      "The user sends the prediction (what, who made it, when, and when it came due), then " +
        "stories from later newsletters, oldest first, one per line: an id, the date, the " +
        "newsletter, the headline and summary, and the names involved. They were found by " +
        "searching, so some are about something else.",
      "Call settle:",
      "- verdict: right only when a story shows this same thing happened, on or before the " +
        "due date. wrong only when a story shows this same thing did not happen by the due " +
        "date: it was delayed, cancelled, came out differently, or happened after the due " +
        "date. unclear otherwise.",
      "- A story about something else is not evidence, even about the same company or " +
        "person: then it is unclear. Silence is unclear, not wrong.",
      "- Compare dates exactly: something that happened on 2 October did not happen by " +
        "1 October.",
      "- why: one sentence saying what the stories show, with the names, numbers and the " +
        "date it happened, or what is missing.",
      "- stories: the ids of the stories about this same thing, for right or wrong.",
      "- Only what the stories say: no outside knowledge, no guesses. No em-dashes.",
    ].join("\n"),
    user: [
      `Prediction: ${p.text}`,
      `Who: ${p.who}${p.own ? ` (${p.publication}'s own call)` : ""}`,
      `Said: ${readerDay(Date.parse(p.saidAt))} in ${p.publication}: "${p.quote}"`,
      `Due: ${p.due}`,
      "",
      ...items.map((i) =>
        [
          i.id,
          readerDay(Date.parse(i.receivedAt)),
          i.publication,
          `${i.headline}. ${i.summary}`,
          i.names.join(", ") || "-",
        ].join(" | "),
      ),
    ].join("\n"),
    tool: {
      name: "settle",
      description: "Record whether the prediction came true, citing the stories that show it.",
      schema: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["right", "wrong", "unclear"] },
          why: { type: "string" },
          stories: { type: "array", items: { type: "string" } },
        },
        required: ["verdict", "why", "stories"],
      },
    },
    maxTokens: 600,
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
 * Claude's verdict, checked: right or wrong needs at least one known story, or it is unclear.
 * The stories become the evidence, oldest first.
 */
export function parseSettle(
  input: unknown,
  items: AskItem[],
): { status: Settlement["status"]; why: string; evidence: PredictionEvidence[] } {
  const o = (input ?? {}) as Record<string, unknown>;
  const byId = new Map(items.map((i) => [i.id, i]));
  const used = [
    ...new Set(
      (Array.isArray(o.stories) ? o.stories : []).flatMap((id) => {
        const item = byId.get(String(id).trim());
        return item ? [item] : [];
      }),
    ),
  ].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const evidence = used.map((i) => ({
    issueId: i.issueId,
    n: i.n,
    publication: i.publication,
    headline: i.headline,
    receivedAt: i.receivedAt,
  }));
  const why = clean(o.why, 400);
  const asked = o.verdict === "right" || o.verdict === "wrong" ? o.verdict : "unclear";
  const status = asked !== "unclear" && evidence.length && why ? asked : "unclear";
  return { status, why: why || NOTHING_SINCE, evidence: status === "unclear" ? [] : evidence };
}

export class Settler {
  constructor(
    private readonly store: SettleStore,
    private readonly corpus: CorpusCache,
    private readonly embedder: Embedder,
    private readonly claude: ClaudePort,
    private readonly model: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Settles today's due predictions, at most `limit`, oldest due first. */
  async settleDue(limit = SETTLE_PER_DAY): Promise<SettleStats> {
    const started = this.now();
    const today = readerDay(started);
    const stats: SettleStats = {
      due: 0,
      right: 0,
      wrong: 0,
      unclear: 0,
      nothingFound: 0,
      later: 0,
      errors: 0,
      inputTokens: 0,
      outputTokens: 0,
      ms: 0,
    };
    const due = (await this.store.listPredictions())
      .filter((p) => settleable(p, today))
      .sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
    stats.due = due.length;
    stats.later = Math.max(0, due.length - limit);
    if (due.length) {
      const [corpus, senders] = await Promise.all([this.corpus.load(), this.store.listSenders()]);
      const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
      const one = async (p: StoredPrediction) => {
        try {
          const eligible = (issueId: string) =>
            issueId !== p.issueId && !muted.has(corpus.issues.get(issueId)?.senderId ?? "");
          const from = addDays(readerDay(Date.parse(p.saidAt)), 1);
          const vector = await this.embedder.embed(p.text);
          const keys = searchStories(
            { query: p.text, from, to: today },
            vector,
            corpus,
            eligible,
            SETTLE_STORIES,
          );
          const items = askItems(keys, corpus);
          const tries = (p.tries ?? 0) + 1;
          const base = { settledAt: new Date(this.now()).toISOString(), tries };
          let s: Settlement;
          if (!items.length) {
            stats.nothingFound++;
            s = { ...base, status: "unclear", why: NOTHING_SINCE, evidence: [] };
          } else {
            const res = await this.claude.callTool(settleRequest(p, items, today));
            stats.inputTokens += res.inputTokens;
            stats.outputTokens += res.outputTokens;
            s = {
              ...base,
              ...parseSettle(res.input, items),
              model: this.model,
              inputTokens: res.inputTokens,
              outputTokens: res.outputTokens,
            };
          }
          if (s.status === "unclear" && tries < SETTLE_TRIES) {
            s.nextTry = addDays(today, RETRY_DAYS);
          }
          await this.store.settlePrediction(p.id, s);
          stats[s.status]++;
        } catch (err) {
          stats.errors++;
          console.error(
            JSON.stringify({
              level: "error",
              msg: "settle failed",
              prediction: p.id,
              error: String(err),
            }),
          );
        }
      };
      const todo = due.slice(0, limit);
      for (let i = 0; i < todo.length; i += CONCURRENCY) {
        await Promise.all(todo.slice(i, i + CONCURRENCY).map(one));
      }
    }
    stats.ms = this.now() - started;
    console.log(
      JSON.stringify({
        level: "info",
        msg: "predictions settled",
        ...stats,
        cents: claudeCents(stats.inputTokens, stats.outputTokens),
      }),
    );
    return stats;
  }
}
