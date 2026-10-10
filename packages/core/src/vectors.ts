/** Embeddings are stored in DynamoDB as float32 bytes. */

/** Every embedding in the table: Titan Text Embeddings V2, 512 dimensions, normalized. */
export const EMBED_MODEL = "amazon.titan-embed-text-v2:0";
export const EMBED_DIMENSIONS = 512;

/** A stored embedding (float32 bytes) as numbers. The copy avoids misaligned buffers. */
export function toVector(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(Math.floor(bytes.byteLength / 4));
  new Uint8Array(out.buffer).set(bytes.subarray(0, out.length * 4));
  return out;
}

/** An embedding as the float32 bytes DynamoDB stores. */
export function vectorBytes(vector: ArrayLike<number>): Uint8Array {
  return new Uint8Array(Float32Array.from(vector).buffer);
}
