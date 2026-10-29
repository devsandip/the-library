import { describe, expect, it } from "vitest";
import { READER } from "@library/core";
import { answerRequest, planRequest } from "../src/ask.js";
import { findRequest } from "../src/hunt.js";
import { settleRequest } from "../src/settle.js";
import { sourceRequest } from "../src/source.js";
import { takesRequest } from "../src/takes.js";
import { timelineRequest } from "../src/timeline.js";

const NURSE = "The reader is a nurse who follows health policy.";
const story = { headline: "H", summary: "S", names: [], publication: "P" } as never;

describe("prompts describe the reader (#186)", () => {
  const made = {
    plan: (about?: string) => planRequest("q", "2026-10-29", about),
    answer: (about?: string) => answerRequest("q", [], "2026-10-29", "UTC", about),
    takes: (about?: string) => takesRequest([], "UTC", about),
    timeline: (about?: string) => timelineRequest([], "UTC", about),
    settle: (about?: string) =>
      settleRequest(
        {
          text: "t",
          who: "w",
          publication: "P",
          quote: "q",
          saidAt: "2026-10-01T00:00:00Z",
          due: "2026-10-20",
        } as never,
        [],
        "2026-10-29",
        "UTC",
        about,
      ),
    source: (about?: string) =>
      sourceRequest(story, "page", "https://example.test", undefined, about),
    find: (about?: string) =>
      findRequest(story, undefined, { text: "", links: [] } as never, about),
  };

  for (const [name, request] of Object.entries(made)) {
    it(`${name}: the reader's own line, or today's without one`, () => {
      expect(JSON.stringify(request(NURSE))).toContain(NURSE);
      expect(JSON.stringify(request(NURSE))).not.toContain(READER);
      expect(JSON.stringify(request())).toContain(READER);
    });
  }
});
