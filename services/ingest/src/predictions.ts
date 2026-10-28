/**
 * Spotting predictions (#24): after the story index, each new issue is screened for dated,
 * checkable predictions. A cheap screen (`forwardPassages`) keeps only sentences that look forward
 * and name a time, with their neighbours; an issue with none is marked screened without a call.
 * Otherwise one Haiku call names up to five, each with who made it, the newsletter's own words, its
 * period and its kind: forecasts and promises are kept, schedules (a date its organiser controls)
 * are not. A prediction is kept only when its words are in the issue word for word and it comes
 * due after the issue was sent.
 */
import { forwardPassages, periodEnd, quoteIn, READER } from "@library/core";
import type { PredictionStats } from "@library/core/types";
import type { ModelPort, ToolRequest } from "./bedrock.js";
import type { EnrichCandidate } from "./enrich.js";
import type { Store } from "./store.js";

/** At most this many predictions per issue; the tool schema says so too. */
const MAX_PREDICTIONS = 5;
/** An issue whose screening failed this many times is left alone: each try costs a call. */
const MAX_ATTEMPTS = 3;
/** Nothing comes due further out than this: a call for 2050 is not one to settle. */
const MAX_YEARS = 20;

/** A prediction ready to store. */
export interface NewPrediction {
  text: string;
  who: string;
  own: boolean;
  kind: "forecast" | "promise";
  quote: string;
  by: string;
  due: string;
  n?: number;
}

export function predictionsRequest(
  issue: { publication: string; subject: string; receivedAt: string },
  stories: { n: number; headline: string }[],
  passages: string,
): ToolRequest {
  return {
    system: [
      `You find predictions in one newsletter issue, for a page that checks later whether they ` +
        `came true. ${READER}`,
      "",
      "The user sends the date the issue was sent, its stories, and passages from it that may " +
        "hold predictions.",
      "Call record_predictions with each prediction that:",
      "- says something specific will or will not happen: a launch, a number reached, a " +
        "decision, a price or rate move, a deal closing, a result;",
      "- has a time frame, stated or plain from the text (by March, next year, in Q3, within " +
        "two years);",
      "- could be checked later from the news.",
      "Skip vague views (AI will change everything), conditions without a time, and things " +
        "that have already happened.",
      "For each:",
      "- text: the prediction in one plain sentence that stands on its own: who expects what, " +
        "by when.",
      "- who: who made it: the person or organisation quoted, or the newsletter's writer.",
      "- own: true when it is the newsletter's own call, not one it reports.",
      "- kind: forecast when someone expects or predicts an outcome they do not control " +
        "(markets, numbers, rivals, governments, a deal closing); promise when a person or " +
        "company commits to an outcome of its own by a deadline, with some doubt in it " +
        "(we'll ship by March, profitable within two years, a target); schedule when it is a " +
        "date set for something its organiser controls, said as fact (ships, launches, " +
        "releases, retires or opens on a day; a rule or change takes effect on a day; someone " +
        "starts a job on a day; an event, vote or report is held on a day; a launch no " +
        "earlier than a day; a company's plan for this week). It is a schedule only when the " +
        "organiser itself says it as fact: when others expect it (analysts, markets, sources, " +
        "the newsletter) or it is hedged (could, expected to, as soon as, likely), it is a " +
        "forecast.",
      "- quote: the passage's exact words that make it, at most 40 words, copied exactly.",
      "- by: when it comes due, as YYYY-MM-DD, YYYY-MM, YYYY-Qn or YYYY, working out words like " +
        "next year or this quarter from the date sent. The period the text gives, not a guess.",
      `- story: the number of the story it belongs to, or 0.`,
      `At most ${MAX_PREDICTIONS}, the most checkable first. None is a fine answer. No em-dashes.`,
    ].join("\n"),
    user: [
      `Newsletter: ${issue.publication}`,
      `Subject: ${issue.subject}`,
      `Sent: ${issue.receivedAt.slice(0, 10)}`,
      "",
      "Stories:",
      ...(stories.length ? stories.map((s) => `${s.n}. ${s.headline}`) : ["(none)"]),
      "",
      "Passages:",
      passages,
    ].join("\n"),
    tool: {
      name: "record_predictions",
      description: "Record the dated, checkable predictions in these passages.",
      schema: {
        type: "object",
        properties: {
          predictions: {
            type: "array",
            maxItems: MAX_PREDICTIONS,
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                who: { type: "string" },
                own: { type: "boolean" },
                kind: { type: "string", enum: ["forecast", "promise", "schedule"] },
                quote: { type: "string" },
                by: { type: "string", description: "YYYY-MM-DD, YYYY-MM, YYYY-Qn or YYYY." },
                story: { type: "integer" },
              },
              required: ["text", "who", "own", "kind", "quote", "by"],
            },
          },
        },
        required: ["predictions"],
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
 * Claude's predictions, checked: each needs its sentence, who, a quote found in the issue word
 * for word, and a period that ends after the day the issue was sent and within twenty years.
 */
export function parsePredictions(
  input: unknown,
  issue: { text: string; receivedAt: string; stories: { n: number }[] },
): NewPrediction[] {
  const list = ((input ?? {}) as { predictions?: unknown }).predictions;
  if (!Array.isArray(list)) throw new Error("no prediction list");
  const sent = issue.receivedAt.slice(0, 10);
  const latest = `${Number(sent.slice(0, 4)) + MAX_YEARS}${sent.slice(4)}`;
  const seen = new Set<string>();
  return list.slice(0, MAX_PREDICTIONS).flatMap((item): NewPrediction[] => {
    const o = (item ?? {}) as Record<string, unknown>;
    const text = clean(o.text, 300);
    const who = clean(o.who, 80);
    const quote = clean(o.quote, 400).replace(/^["“]|["”]$/g, "");
    const by = clean(o.by, 10);
    const due = periodEnd(by);
    // A schedule (a date its organiser controls) is not a prediction; nor is a missing kind.
    const kind = o.kind === "forecast" || o.kind === "promise" ? o.kind : undefined;
    if (!text || !who || !kind || !due || due <= sent || due > latest) return [];
    if (!quoteIn(issue.text, quote) || seen.has(quote.toLowerCase())) return [];
    seen.add(quote.toLowerCase());
    const n = Number(o.story);
    const story = issue.stories.some((s) => s.n === n) ? n : undefined;
    return [
      { text, who, own: o.own === true, kind, quote, by, due, ...(story ? { n: story } : {}) },
    ];
  });
}

/** One of an issue's stored predictions, as a forced screening weighs it. */
export interface ExistingPrediction {
  k: number;
  quote: string;
  status: string;
  setBy?: string;
}

/**
 * A forced screening's changes to one issue: its open predictions go, unless Sandip set them;
 * settled ones and his stay, and a new one with a staying one's words is not added again. New
 * ones take the lowest numbers not kept, overwriting the open ones there.
 */
export function replacePredictions(
  existing: ExistingPrediction[],
  found: NewPrediction[],
): { remove: number[]; add: { k: number; prediction: NewPrediction }[] } {
  const stays = existing.filter((e) => e.status !== "open" || e.setBy);
  const taken = new Set(stays.map((e) => e.k));
  const quotes = new Set(stays.map((e) => e.quote.toLowerCase()));
  const add: { k: number; prediction: NewPrediction }[] = [];
  let k = 1;
  for (const prediction of found) {
    if (quotes.has(prediction.quote.toLowerCase())) continue;
    while (taken.has(k)) k++;
    taken.add(k);
    add.push({ k, prediction });
  }
  // A number a new one takes is overwritten, not removed: one batch cannot do both to a key.
  const reused = new Set(add.map((a) => a.k));
  const remove = existing.filter((e) => !stays.includes(e) && !reused.has(e.k)).map((e) => e.k);
  return { remove, add };
}

export interface PredictionOptions {
  sinceIso: string;
  /** Screen issues again (after a prompt change), keeping settled predictions and Sandip's. */
  force?: boolean;
  concurrency?: number;
  /** Epoch ms after which no new issue is started; the rest wait for the next run. */
  deadline?: number;
}

/**
 * Screen the issues received since `sinceIso` that have not been screened yet. Promos and muted
 * newsletters are left out, as they are from stories.
 */
export async function spotPredictions(
  store: Store,
  model: ModelPort,
  opts: PredictionOptions,
): Promise<PredictionStats> {
  const started = Date.now();
  const stats: PredictionStats = {
    checked: 0,
    screened: 0,
    called: 0,
    predictions: 0,
    deferred: 0,
    errors: 0,
    errorSamples: [],
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  const screen = async (issue: EnrichCandidate) => {
    const text = (await store.getText(issue.id)) ?? "";
    const passages = forwardPassages(text);
    let found: NewPrediction[] = [];
    if (passages) {
      const stories = await store.issueStories(issue.id);
      const res = await model.callTool(predictionsRequest(issue, stories, passages));
      stats.called++;
      stats.inputTokens += res.inputTokens;
      stats.outputTokens += res.outputTokens;
      found = parsePredictions(res.input, { text, receivedAt: issue.receivedAt, stories });
    }
    const existing = opts.force ? await store.issuePredictions(issue.id) : [];
    const changes = replacePredictions(existing, found);
    await store.putPredictions(issue, changes.add, changes.remove);
    stats.screened++;
    stats.predictions += changes.add.length;
  };

  const [candidates, senders] = await Promise.all([
    store.enrichCandidates(opts.sinceIso),
    store.senderSettings(),
  ]);
  const todo = candidates
    .filter((c) => !c.promo && !senders.get(c.senderId)?.muted)
    .filter((c) => opts.force || (!c.predicted && (c.predictionAttempts ?? 0) < MAX_ATTEMPTS))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
  stats.checked = todo.length;

  const size = opts.concurrency ?? 4;
  for (let i = 0; i < todo.length; i += size) {
    if (opts.deadline && Date.now() > opts.deadline) {
      stats.deferred = todo.length - i;
      break;
    }
    await Promise.all(
      todo.slice(i, i + size).map((issue) =>
        screen(issue).catch(async (err: Error) => {
          stats.errors++;
          if (stats.errorSamples.length < 5) stats.errorSamples.push(`${issue.id}: ${err.message}`);
          console.error(
            JSON.stringify({
              level: "error",
              msg: "predictions failed",
              id: issue.id,
              error: String(err),
            }),
          );
          await store.putPredictionError(issue.id, err.message).catch(() => undefined);
        }),
      ),
    );
  }
  stats.durationMs = Date.now() - started;
  return stats;
}
