import { describe, expect, it, vi } from "vitest";
import { createJobHandler } from "../src/jobs.js";

describe("jobs", () => {
  it("runs a source check, and throws what it throws so the Lambda counts the error", async () => {
    const checker = { check: vi.fn(async () => ({})) };
    const handler = createJobHandler(checker);
    await handler({ kind: "source", id: "tldr", n: 2 });
    expect(checker.check).toHaveBeenCalledWith("tldr", 2);

    checker.check.mockRejectedValueOnce(new Error("bedrock down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(handler({ kind: "source", id: "tldr", n: 2 })).rejects.toThrow("bedrock down");
  });

  it("refuses a job it does not know", async () => {
    const handler = createJobHandler({ check: vi.fn() });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(handler({ kind: "backstory" } as never)).rejects.toThrow("unknown job backstory");
  });
});
