import { describe, expect, it } from "vitest";
import { READER } from "@library/core";
import { classifyRequest, topicsRequest } from "../src/enrich.js";
import { movesRequest } from "../src/follow.js";
import { storyState } from "../src/jev.js";
import { narrativeRequest } from "../src/narrative.js";
import { predictionsRequest } from "../src/predictions.js";
import { storiesRequest } from "../src/stories.js";

const NURSE = "The reader is a nurse who follows health policy.";
const issue = { publication: "P", subject: "S", text: "T", receivedAt: "2026-10-29T00:00:00Z" };

describe("ingest's prompts describe the owner (#186)", () => {
  const made = {
    classify: (about?: string) => classifyRequest(issue, [], about),
    topics: (about?: string) => topicsRequest([], about),
    narrative: (about?: string) => narrativeRequest([], about),
    stories: (about?: string) => storiesRequest(issue, "text", about),
    predictions: (about?: string) => predictionsRequest(issue, [], "", about),
    moves: (about?: string) => movesRequest([], "UTC", about),
    jev: (about?: string) => storyState({ publication: "P", headline: "H", summary: "S" }, about),
  };

  for (const [name, request] of Object.entries(made)) {
    it(`${name}: the owner's line, or today's without one`, () => {
      expect(JSON.stringify(request(NURSE))).toContain(NURSE);
      expect(JSON.stringify(request(NURSE))).not.toContain(READER);
      expect(JSON.stringify(request())).toContain(READER);
    });
  }
});
