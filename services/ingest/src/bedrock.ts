/**
 * The two Bedrock models enrichment uses, behind a small port so tests can fake them.
 * Classification is one forced tool call to Claude Haiku with thinking explicitly off (Haiku 5.5
 * thinks by default, and leaving the field out does not turn it off). Embeddings are Titan Text V2.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { CLAUDE_MODEL, EMBED_DIMENSIONS, EMBED_MODEL } from "@library/core";

export const MODELS = {
  // Haiku 4.5 until the account has 5.5 (packages/core/src/claude.ts). After a switch,
  // `pnpm enrich --force` if older issues should be redone.
  classify: CLAUDE_MODEL,
  embed: EMBED_MODEL,
} as const;

export interface ToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface ToolRequest {
  system: string;
  user: string;
  tool: ToolSpec;
  maxTokens: number;
}

export interface ToolResult {
  /** The tool input Claude produced; validate before use. */
  input: unknown;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelPort {
  callTool(req: ToolRequest): Promise<ToolResult>;
  embed(text: string): Promise<{ vector: number[]; tokens: number }>;
}

export class Bedrock implements ModelPort {
  private readonly client: BedrockRuntimeClient;

  constructor(client?: BedrockRuntimeClient) {
    // Retries cover throttling, which the backlog run can hit.
    this.client = client ?? new BedrockRuntimeClient({ maxAttempts: 6 });
  }

  async callTool(req: ToolRequest): Promise<ToolResult> {
    const res = await this.client.send(
      new ConverseCommand({
        modelId: MODELS.classify,
        system: [{ text: req.system }],
        messages: [{ role: "user", content: [{ text: req.user }] }],
        toolConfig: {
          tools: [
            {
              toolSpec: {
                name: req.tool.name,
                description: req.tool.description,
                inputSchema: { json: req.tool.schema as never },
              },
            },
          ],
          toolChoice: { tool: { name: req.tool.name } },
        },
        inferenceConfig: { maxTokens: req.maxTokens, temperature: 0 },
        additionalModelRequestFields: { thinking: { type: "disabled" } },
      }),
    );
    const use = res.output?.message?.content?.find((c) => c.toolUse)?.toolUse;
    if (!use || use.name !== req.tool.name) {
      throw new Error(`model did not call ${req.tool.name} (stop: ${res.stopReason ?? "?"})`);
    }
    return {
      input: use.input,
      inputTokens: res.usage?.inputTokens ?? 0,
      outputTokens: res.usage?.outputTokens ?? 0,
    };
  }

  async embed(text: string): Promise<{ vector: number[]; tokens: number }> {
    const res = await this.client.send(
      new InvokeModelCommand({
        modelId: MODELS.embed,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({ inputText: text, dimensions: EMBED_DIMENSIONS, normalize: true }),
      }),
    );
    const out = JSON.parse(new TextDecoder().decode(res.body)) as {
      embedding?: number[];
      inputTextTokenCount?: number;
    };
    if (!out.embedding || out.embedding.length !== EMBED_DIMENSIONS) {
      throw new Error("embedding has the wrong size");
    }
    return { vector: out.embedding, tokens: out.inputTextTokenCount ?? 0 };
  }
}
