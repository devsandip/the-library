/** Embeddings are stored in DynamoDB as float32 bytes. */

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
