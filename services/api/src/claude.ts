/**
 * Claude on Bedrock for a story's timeline (#19): one forced tool call with thinking explicitly
 * off, as ingest calls it (services/ingest/src/bedrock.ts). Behind a small port so tests can fake it.
 */
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { CLAUDE_MODEL } from "@library/core";

export interface ToolRequest {
  system: string;
  user: string;
  tool: { name: string; description: string; schema: Record<string, unknown> };
  maxTokens: number;
}

export interface ToolResult {
  /** The tool input Claude produced; validate before use. */
  input: unknown;
  inputTokens: number;
  outputTokens: number;
}

export interface ClaudePort {
  callTool(req: ToolRequest): Promise<ToolResult>;
}

export class BedrockClaude implements ClaudePort {
  // One retry: the reader is waiting, and the Lambda has 15 seconds.
  constructor(private readonly client = new BedrockRuntimeClient({ maxAttempts: 2 })) {}

  async callTool(req: ToolRequest): Promise<ToolResult> {
    const res = await this.client.send(
      new ConverseCommand({
        modelId: CLAUDE_MODEL,
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
}
