/** Titan Text Embeddings V2 for a search query (#53), as ingest embeds stories. */
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { EMBED_DIMENSIONS, EMBED_MODEL } from "@library/core";
import type { Embedder } from "./search.js";

export class TitanEmbedder implements Embedder {
  constructor(private readonly client = new BedrockRuntimeClient({ maxAttempts: 3 })) {}

  async embed(text: string): Promise<Float32Array> {
    const res = await this.client.send(
      new InvokeModelCommand({
        modelId: EMBED_MODEL,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({ inputText: text, dimensions: EMBED_DIMENSIONS, normalize: true }),
      }),
    );
    const out = JSON.parse(new TextDecoder().decode(res.body)) as { embedding?: number[] };
    if (out.embedding?.length !== EMBED_DIMENSIONS) throw new Error("embedding has the wrong size");
    return Float32Array.from(out.embedding);
  }
}
