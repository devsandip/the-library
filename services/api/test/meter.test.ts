import { describe, expect, it, vi } from "vitest";
import type { Feature, Use } from "@library/core/usage";
import { TitanEmbedder } from "../src/embed.js";
import { meteredClaude } from "../src/meter.js";

const req = {
  system: "s",
  user: "u",
  tool: { name: "t", description: "d", schema: {} },
  maxTokens: 10,
};

describe("the meter (#208)", () => {
  it("records each Claude call for its feature and hands the answer on", async () => {
    const record = vi.fn(async (_f: Feature, _u: Omit<Use, "calls">) => undefined);
    const claude = {
      callTool: vi.fn(async () => ({ input: { ok: 1 }, inputTokens: 1000, outputTokens: 200 })),
    };
    const res = await meteredClaude(claude, "ask", { record }).callTool(req);
    expect(res.input).toEqual({ ok: 1 });
    expect(record).toHaveBeenCalledWith("ask", {
      inputTokens: 1000,
      outputTokens: 200,
      cents: 0.2,
    });
  });

  it("never costs the reader their answer when recording fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const record = vi.fn(async () => Promise.reject(new Error("dynamo down")));
    const claude = { callTool: vi.fn(async () => ({ input: 1, inputTokens: 1, outputTokens: 1 })) };
    await expect(meteredClaude(claude, "takes", { record }).callTool(req)).resolves.toMatchObject({
      input: 1,
    });
  });

  it("tells the meter each embedding's tokens", async () => {
    const body = new TextEncoder().encode(
      JSON.stringify({ embedding: Array.from({ length: 512 }, () => 0.1), inputTextTokenCount: 7 }),
    );
    const client = { send: vi.fn(async () => ({ body })) };
    const onTokens = vi.fn(async (_t: number) => undefined);
    await new TitanEmbedder(client as never, onTokens).embed("q");
    expect(onTokens).toHaveBeenCalledWith(7);
  });
});
