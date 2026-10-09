import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it } from "vitest";
import { Bedrock, MODELS } from "../src/bedrock.js";

function client(response: unknown) {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const fake = {
    send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      return response;
    },
  } as unknown as BedrockRuntimeClient;
  return { bedrock: new Bedrock(fake), sent };
}

const tool = { name: "classify_issue", description: "d", schema: { type: "object" } };

describe("Bedrock", () => {
  it("calls Haiku 5.5 with thinking off, the tool forced and temperature 0", async () => {
    const { bedrock, sent } = client({
      output: {
        message: { content: [{ toolUse: { name: "classify_issue", input: { shelf: "news" } } }] },
      },
      usage: { inputTokens: 1200, outputTokens: 35 },
    });
    const res = await bedrock.callTool({ system: "s", user: "u", tool, maxTokens: 300 });
    expect(res).toEqual({ input: { shelf: "news" }, inputTokens: 1200, outputTokens: 35 });
    expect(sent[0]!.name).toBe("ConverseCommand");
    expect(sent[0]!.input).toMatchObject({
      modelId: MODELS.classify,
      additionalModelRequestFields: { thinking: { type: "disabled" } },
      toolConfig: { toolChoice: { tool: { name: "classify_issue" } } },
      inferenceConfig: { maxTokens: 300, temperature: 0 },
    });
  });

  it("fails clearly when the model answers without the tool", async () => {
    const { bedrock } = client({
      output: { message: { content: [{ text: "Sure!" }] } },
      stopReason: "end_turn",
    });
    await expect(
      bedrock.callTool({ system: "s", user: "u", tool, maxTokens: 300 }),
    ).rejects.toThrow("did not call classify_issue (stop: end_turn)");
  });

  it("embeds with Titan V2 at 512 dimensions, normalized", async () => {
    const body = new TextEncoder().encode(
      JSON.stringify({ embedding: new Array(512).fill(0.5), inputTextTokenCount: 7 }),
    );
    const { bedrock, sent } = client({ body });
    const res = await bedrock.embed("hello");
    expect(res.tokens).toBe(7);
    expect(res.vector).toHaveLength(512);
    expect(sent[0]!.input.modelId).toBe(MODELS.embed);
    expect(JSON.parse(sent[0]!.input.body as string)).toEqual({
      inputText: "hello",
      dimensions: 512,
      normalize: true,
    });
  });
});
