/**
 * Spotting predictions (#24): after the story index, each new issue is screened for dated,
 * checkable predictions. A cheap screen (`forwardPassages`) keeps only sentences that look forward
 * and name a time, with their neighbours; an issue with none is marked screened without a call.
 * Otherwise one Haiku call names up to five, each with who made it, the newsletter's own words and
 * its period. A prediction is kept only when its words are in the issue word for word and it comes
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
      "Skip vague views (AI will change everything), conditions without a time, dates already " +
        "fixed by whoever runs them (a launch event a company has scheduled, an election date), " +
        "and things that have already happened.",
      "For each:",
      "- text: the prediction in one plain sentence that stands on its own: who expects what, " +
        "by when.",
      "- who: who made it: the person or organisation quoted, or the newsletter's writer.",
      "- own: true when it is the newsletter's own call, not one it reports.",
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
                quote: { type: "string" },
                by: { type: "string", description: "YYYY-MM-DD, YYYY-MM, YYYY-Qn or YYYY." },
                story: { type: "integer" },
              },
              required: ["text", "who", "own", "quote", "by"],
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
    if (!text || !who || !due || due <= sent || due > latest) return [];
    if (!quoteIn(issue.text, quote) || seen.has(quote.toLowerCase())) return [];
    seen.add(quote.toLowerCase());
    const n = Number(o.story);
    const story = issue.stories.some((s) => s.n === n) ? n : undefined;
    return [{ text, who, own: o.own === true, quote, by, due, ...(story ? { n: story } : {}) }];
  });
}

export interface PredictionOptions {
  sinceIso: string;
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
    await store.putPredictions(issue, found);
    stats.screened++;
    stats.predictions += found.length;
  };

  const [candidates, senders] = await Promise.all([
    store.enrichCandidates(opts.sinceIso),
    store.senderSettings(),
  ]);
  const todo = candidates
    .filter((c) => !c.promo && !senders.get(c.senderId)?.muted)
    .filter((c) => !c.predicted && (c.predictionAttempts ?? 0) < MAX_ATTEMPTS)
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
