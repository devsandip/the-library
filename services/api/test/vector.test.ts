import { describe, expect, it } from "vitest";
import { toVector } from "../src/repo.js";

describe("toVector", () => {
  it("reads float32 bytes back as numbers, even from an odd offset", () => {
    const v = new Float32Array([0.25, -1.5, 3]);
    const bytes = new Uint8Array(v.buffer);
    expect([...toVector(bytes)]).toEqual([0.25, -1.5, 3]);
    // DynamoDB hands back views into larger buffers; this one starts at byte 1.
    const shifted = new Uint8Array(bytes.length + 1);
    shifted.set(bytes, 1);
    expect([...toVector(shifted.subarray(1))]).toEqual([0.25, -1.5, 3]);
  });
});
