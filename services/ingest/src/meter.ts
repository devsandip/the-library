/**
 * Ingest's model calls recorded against the owner (#208), by the step that made them: Claude and
 * Titan behind the model port, Jev behind its own. A failed record is logged and the run goes on.
 */
import { claudeUse, titanUse, type Feature, type Meter, type Use } from "@library/core/usage";
import type { ModelPort } from "./bedrock.js";
import type { DecisionPort } from "./jev.js";

async function note(meter: Meter, feature: Feature, use: Omit<Use, "calls">) {
  try {
    await meter.record(feature, use);
  } catch (err) {
    console.error(
      JSON.stringify({ level: "error", msg: "usage not recorded", feature, error: String(err) }),
    );
  }
}

/** The model port, its calls and embeddings recorded for `feature`. */
export function meteredModel(model: ModelPort, feature: Feature, meter: Meter): ModelPort {
  return {
    async callTool(req) {
      const res = await model.callTool(req);
      await note(meter, feature, claudeUse(res.inputTokens, res.outputTokens));
      return res;
    },
    async embed(text) {
      const res = await model.embed(text);
      await note(meter, feature, titanUse(res.tokens));
      return res;
    },
  };
}

/** Jev, its questions recorded as `shelves`: tokens, no price (TypeSafe's is not known here). */
export function meteredJev(jev: DecisionPort, meter: Meter): DecisionPort {
  return {
    async decide(state, questions) {
      const d = await jev.decide(state, questions);
      await note(meter, "shelves", {
        inputTokens: d.inputTokens,
        outputTokens: d.outputTokens,
        cents: 0,
      });
      return d;
    },
  };
}
