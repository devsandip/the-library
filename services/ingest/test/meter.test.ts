import { describe, expect, it, vi } from "vitest";
import type { Feature, Use } from "@library/core/usage";
import { meteredJev, meteredModel } from "../src/meter.js";

describe("ingest's meter (#208)", () => {
  it("records Claude and Titan calls for the step that made them", async () => {
    const record = vi.fn(async (_f: Feature, _u: Omit<Use, "calls">) => undefined);
    const model = {
      callTool: vi.fn(async () => ({ input: {}, inputTokens: 1500, outputTokens: 60 })),
      embed: vi.fn(async () => ({ vector: [1], tokens: 100 })),
    };
    const m = meteredModel(model as never, "enrich", { record });
    await m.callTool({} as never);
    await m.embed("t");
    expect(record).toHaveBeenNthCalledWith(1, "enrich", {
      inputTokens: 1500,
      outputTokens: 60,
      cents: 0.18,
    });
    expect(record.mock.calls[1]![0]).toBe("enrich");
    expect(record.mock.calls[1]![1].inputTokens).toBe(100);
  });

  it("records Jev's questions as shelves, tokens without a price", async () => {
    const record = vi.fn(async (_f: Feature, _u: Omit<Use, "calls">) => undefined);
    const jev = {
      decide: vi.fn(async () => ({ model: "jev", answers: {}, inputTokens: 300, outputTokens: 5 })),
    };
    await meteredJev(jev, { record }).decide("state", {});
    expect(record).toHaveBeenCalledWith("shelves", { inputTokens: 300, outputTokens: 5, cents: 0 });
  });
});
