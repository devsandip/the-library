import { DEFAULT_SETTINGS } from "@library/core/settings";
import { describe, expect, it, vi } from "vitest";
import type { ModelPort, ToolRequest } from "../src/bedrock.js";
import type { EnrichCandidate } from "../src/enrich.js";
import {
  parsePredictions,
  predictionsRequest,
  replacePredictions,
  spotPredictions,
  type ExistingPrediction,
  type NewPrediction,
} from "../src/predictions.js";
import type { Store } from "../src/store.js";

const sent = "2026-09-03T08:00:00.000Z";
const text =
  "Welcome to the issue. Background on the company. OpenAI will ship GPT-6 by March 2027, " +
  "its chief executive said on a podcast. We think rates fall in December. That is all.";

describe("predictionsRequest", () => {
  it("sends the date sent, the stories and the passages", () => {
    const req = predictionsRequest(
      { publication: "TLDR AI", subject: "Agents", receivedAt: sent },
      [{ n: 1, headline: "OpenAI's next model" }],
      "OpenAI will ship GPT-6 by March 2027.",
    );
    expect(req.tool.name).toBe("record_predictions");
    expect(req.user).toContain("Sent: 2026-09-03");
    expect(req.user).toContain("1. OpenAI's next model");
    expect(req.user).toContain("OpenAI will ship GPT-6 by March 2027.");
    expect(req.system).toContain("copied exactly");
  });
});

describe("parsePredictions", () => {
  const issue = { text, receivedAt: sent, stories: [{ n: 1 }, { n: 2 }] };
  const ok = {
    text: "OpenAI will ship GPT-6 by March 2027.",
    who: "OpenAI's chief executive",
    own: false,
    kind: "promise",
    quote: "OpenAI will ship GPT-6 by March 2027",
    by: "2027-03",
    story: 1,
  };

  it("keeps a prediction found in the issue, due at the end of its period", () => {
    expect(parsePredictions({ predictions: [ok] }, issue)).toEqual([
      {
        text: "OpenAI will ship GPT-6 by March 2027.",
        who: "OpenAI's chief executive",
        own: false,
        kind: "promise",
        quote: "OpenAI will ship GPT-6 by March 2027",
        by: "2027-03",
        due: "2027-03-31",
        n: 1,
      },
    ]);
  });

  it("drops a schedule, a date its organiser controls, and one with no kind (#143)", () => {
    const schedule = { ...ok, kind: "schedule" };
    const { kind: _kind, ...noKind } = ok;
    expect(parsePredictions({ predictions: [schedule, noKind] }, issue)).toEqual([]);
  });

  it("drops one whose words are not in the issue, or that comes due by the day it was sent", () => {
    const made = { ...ok, quote: "OpenAI will ship GPT-6 next spring" };
    const past = { ...ok, by: "2026-08" };
    const sameDay = { ...ok, by: "2026-09-03" };
    const tooFar = { ...ok, by: "2050" };
    const vague = { ...ok, by: "soon" };
    expect(parsePredictions({ predictions: [made, past, sameDay, tooFar, vague] }, issue)).toEqual(
      [],
    );
  });

  it("keeps the newsletter's own call, no story when it names none, and each quote once", () => {
    const own = {
      text: "Rates fall in December.",
      who: "the newsletter",
      own: true,
      kind: "forecast",
      quote: "We think rates fall in December",
      by: "2026-12",
      story: 0,
    };
    const got = parsePredictions({ predictions: [own, own] }, issue);
    expect(got).toEqual([
      {
        text: "Rates fall in December.",
        who: "the newsletter",
        own: true,
        kind: "forecast",
        quote: "We think rates fall in December",
        by: "2026-12",
        due: "2026-12-31",
      },
    ]);
  });

  it("throws on an answer with no list, so the issue is tried again", () => {
    expect(() => parsePredictions({}, issue)).toThrow("no prediction list");
  });
});

describe("replacePredictions", () => {
  const found = (quote: string): NewPrediction => ({
    text: quote,
    who: "someone",
    own: false,
    kind: "forecast",
    quote,
    by: "2027",
    due: "2027-12-31",
  });

  it("numbers a first screening's predictions from 1", () => {
    expect(replacePredictions([], [found("a b c d e f g h"), found("i j k l m n o p")])).toEqual({
      remove: [],
      add: [
        { k: 1, prediction: found("a b c d e f g h") },
        { k: 2, prediction: found("i j k l m n o p") },
      ],
    });
  });

  it("removes open ones, keeps settled ones and Sandip's, and never adds a kept one again", () => {
    const existing: ExistingPrediction[] = [
      { k: 1, quote: "Rates fall this year", status: "right" },
      { k: 2, quote: "Old open one", status: "open" },
      { k: 3, quote: "Sandip kept this", status: "open", setBy: "sandip" },
    ];
    const got = replacePredictions(existing, [
      found("rates fall this year"),
      found("A new one here"),
    ]);
    // The new one takes 2, overwriting the open one there; with nothing new, 2 is removed.
    expect(got).toEqual({ remove: [], add: [{ k: 2, prediction: found("A new one here") }] });
    expect(replacePredictions(existing, [])).toEqual({ remove: [2], add: [] });
  });

  it("never removes and adds the same number, which one batch cannot do", () => {
    const existing: ExistingPrediction[] = [1, 2, 3].map((k) => ({
      k,
      quote: `Old open ${k}`,
      status: "open",
    }));
    expect(replacePredictions(existing, [found("A new one here")])).toEqual({
      remove: [2, 3],
      add: [{ k: 1, prediction: found("A new one here") }],
    });
  });
});

describe("spotPredictions", () => {
  const issue = (id: string, over: Partial<EnrichCandidate> = {}): EnrichCandidate => ({
    id,
    senderId: "s1",
    publication: "TLDR AI",
    subject: "Agents",
    receivedAt: sent,
    enriched: true,
    embedded: true,
    storied: true,
    ...over,
  });

  function setup(candidates: EnrichCandidate[], texts: Record<string, string>, answer?: unknown) {
    const put = new Map<string, NewPrediction[]>();
    const removed = new Map<string, number[]>();
    const errors: string[] = [];
    const store = {
      settings: async () => DEFAULT_SETTINGS,
      enrichCandidates: vi.fn(async () => candidates),
      senderSettings: vi.fn(async () => new Map([["muted", { muted: true }]])),
      getText: vi.fn(async (id: string) => texts[id]),
      issueStories: vi.fn(async () => [{ n: 1, headline: "OpenAI's next model" }]),
      issuePredictions: vi.fn(async (): Promise<ExistingPrediction[]> => [
        { k: 1, quote: "Settled earlier", status: "wrong" },
        { k: 2, quote: "Open earlier", status: "open" },
      ]),
      putPredictions: vi.fn(
        async (i: { id: string }, add: { prediction: NewPrediction }[], remove: number[] = []) => {
          put.set(
            i.id,
            add.map((a) => a.prediction),
          );
          removed.set(i.id, remove);
        },
      ),
      putPredictionError: vi.fn(async (id: string) => void errors.push(id)),
    } as unknown as Store;
    const calls: ToolRequest[] = [];
    const model: ModelPort = {
      callTool: vi.fn(async (req: ToolRequest) => {
        calls.push(req);
        if (answer instanceof Error) throw answer;
        return { input: answer, inputTokens: 900, outputTokens: 120 };
      }),
      embed: vi.fn(),
    };
    return { store, model, put, removed, errors, calls };
  }

  const answer = {
    predictions: [
      {
        text: "OpenAI will ship GPT-6 by March 2027.",
        who: "OpenAI's chief executive",
        own: false,
        kind: "promise",
        quote: "OpenAI will ship GPT-6 by March 2027",
        by: "2027-03",
        story: 1,
      },
    ],
  };

  it("calls Claude only for issues with forward-looking passages, and marks every one screened", async () => {
    const { store, model, put, calls } = setup(
      [
        issue("a"),
        issue("quiet"),
        issue("promo", { promo: true }),
        issue("done", { predicted: true }),
      ],
      { a: text, quiet: "Nothing ahead. Only the past here, and it is long gone now." },
      answer,
    );
    const stats = await spotPredictions(store, model, { sinceIso: "2026-01-01" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.user).toContain("OpenAI will ship GPT-6 by March 2027");
    expect(put.get("a")).toHaveLength(1);
    expect(put.get("quiet")).toEqual([]);
    expect(put.has("promo") || put.has("done")).toBe(false);
    expect(stats).toMatchObject({ checked: 2, screened: 2, called: 1, predictions: 1, errors: 0 });
    expect(stats.inputTokens).toBe(900);
  });

  it("counts a failed screening on the issue and leaves an issue that failed three times", async () => {
    const { store, model, errors, put } = setup(
      [issue("a"), issue("tired", { predictionAttempts: 3 })],
      { a: text, tired: text },
      new Error("throttled"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stats = await spotPredictions(store, model, { sinceIso: "2026-01-01" });
    expect(errors).toEqual(["a"]);
    expect(put.size).toBe(0);
    expect(stats).toMatchObject({ checked: 1, errors: 1, screened: 0 });
  });

  it("screens done issues again when forced, removing their open predictions (#143)", async () => {
    const { store, model, put, removed } = setup(
      [issue("done", { predicted: true }), issue("promo", { promo: true, predicted: true })],
      { done: text },
      answer,
    );
    const stats = await spotPredictions(store, model, { sinceIso: "2026-01-01", force: true });
    expect(stats).toMatchObject({ checked: 1, screened: 1, predictions: 1 });
    // Number 1 is settled and stays, so the new one takes 2 and overwrites the open one there.
    expect(removed.get("done")).toEqual([]);
    expect(put.get("done")).toHaveLength(1);
  });

  it("leaves the rest for the next run when time is up", async () => {
    const { store, model } = setup([issue("a"), issue("b")], { a: text, b: text }, answer);
    const stats = await spotPredictions(store, model, {
      sinceIso: "2026-01-01",
      deadline: Date.now() - 1,
    });
    expect(stats).toMatchObject({ checked: 2, deferred: 2, screened: 0 });
  });
});
