/**
 * Model calls recorded against the reader who caused them (#208): Claude and Titan behind the
 * same ports, each wrapped with the feature it serves. A failed record is logged and the answer
 * still goes out: the meter must never cost the reader their answer.
 */
import { claudeUse, titanUse, type Feature, type Meter, type Use } from "@library/core/usage";
import type { ClaudePort } from "./claude.js";
import { TitanEmbedder } from "./embed.js";
import type { Embedder } from "./search.js";

async function note(meter: Meter, feature: Feature, use: Omit<Use, "calls">) {
  try {
    await meter.record(feature, use);
  } catch (err) {
    console.error(
      JSON.stringify({ level: "error", msg: "usage not recorded", feature, error: String(err) }),
    );
  }
}

/** Claude, its calls recorded for `feature`. */
export function meteredClaude(claude: ClaudePort, feature: Feature, meter: Meter): ClaudePort {
  return {
    async callTool(req) {
      const res = await claude.callTool(req);
      await note(meter, feature, claudeUse(res.inputTokens, res.outputTokens));
      return res;
    },
  };
}

/** Titan, its embeddings recorded for `feature`. */
export function meteredEmbedder(feature: Feature, meter: Meter): Embedder {
  return new TitanEmbedder(undefined, (tokens) => note(meter, feature, titanUse(tokens)));
}
