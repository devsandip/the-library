import { describe, expect, it, vi } from "vitest";
import {
  JEV_MODEL,
  JEV_URL,
  Jev,
  SHELF_QUESTIONS,
  learningProbability,
  storyState,
} from "../src/jev.js";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("Jev.decide", () => {
  const answer = {
    model: "jev-1.13.0",
    answers: {
      shelf: {
        type: "choice",
        choice: "learning",
        confidence: 1,
        probabilities: { news: 0, learning: 1 },
      },
    },
    usage: { input_tokens: 410, output_tokens: 48 },
  };

  it("sends the state and questions with the key, and reads the answers and usage", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      ok(answer),
    );
    const d = await new Jev("k", fetchImpl as unknown as typeof fetch).decide(
      "state",
      SHELF_QUESTIONS,
    );
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(JEV_URL);
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(JSON.parse(init!.body as string)).toEqual({
      model: JEV_MODEL,
      state: "state",
      questions: SHELF_QUESTIONS,
    });
    expect(d).toEqual({
      model: "jev-1.13.0",
      answers: answer.answers,
      inputTokens: 410,
      outputTokens: 48,
    });
  });

  it("retries a rate limit, then gives up on a bad request", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
        .mockResolvedValueOnce(ok(answer));
      const pending = new Jev("k", fetchImpl).decide("state", SHELF_QUESTIONS);
      await vi.runAllTimersAsync();
      expect((await pending).inputTokens).toBe(410);
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      const bad = vi
        .fn()
        .mockResolvedValue(new Response("questions: field required", { status: 422 }));
      await expect(new Jev("k", bad).decide("state", SHELF_QUESTIONS)).rejects.toThrow(
        "jev 422: questions: field required",
      );
      expect(bad).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("learningProbability", () => {
  it("reads either phrasing", () => {
    expect(
      learningProbability({
        type: "choice",
        choice: "news",
        confidence: 0.7,
        probabilities: { news: 0.7, learning: 0.3 },
      }),
    ).toBe(0.3);
    expect(learningProbability({ type: "noul", noul: 0.6 })).toBe(0.6);
  });

  it("throws on a missing or impossible answer", () => {
    expect(() => learningProbability(undefined)).toThrow("unusable jev answer");
    expect(() =>
      learningProbability({ type: "choice", choice: "x", confidence: 1, probabilities: {} }),
    ).toThrow("unusable jev answer");
    expect(() => learningProbability({ type: "noul", noul: 1.5 })).toThrow("unusable jev answer");
  });
});

describe("storyState", () => {
  it("gives Jev the reader, the newsletter and the story", () => {
    const s = storyState({
      publication: "ByteByteGo",
      headline: "Caches",
      summary: "How they fail.",
    });
    expect(s).toContain("senior product manager");
    expect(s).toContain("Newsletter: ByteByteGo\nHeadline: Caches\nSummary: How they fail.");
  });
});
