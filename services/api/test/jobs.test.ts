import { describe, expect, it, vi } from "vitest";
import { createJobHandler } from "../src/jobs.js";

const stats = {
  due: 1,
  right: 1,
  wrong: 0,
  unclear: 0,
  nothingFound: 0,
  later: 0,
  errors: 0,
  inputTokens: 1,
  outputTokens: 1,
  ms: 1,
};

function setup() {
  const checker = { check: vi.fn(async () => ({})) };
  const settler = { settleDue: vi.fn(async () => stats) };
  return { checker, settler, handler: createJobHandler({ checker, settler }) };
}

describe("jobs", () => {
  it("runs a source check, and throws what it throws so the Lambda counts the error", async () => {
    const { checker, handler } = setup();
    await handler({ kind: "source", id: "tldr", n: 2 });
    expect(checker.check).toHaveBeenCalledWith("tldr", 2);

    checker.check.mockRejectedValueOnce(new Error("bedrock down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(handler({ kind: "source", id: "tldr", n: 2 })).rejects.toThrow("bedrock down");
  });

  it("settles the day's due predictions and answers what it did (#139)", async () => {
    const { settler, handler } = setup();
    expect(await handler({ kind: "settle" })).toEqual(stats);
    expect(settler.settleDue).toHaveBeenCalledWith(undefined);
    await handler({ kind: "settle", limit: 5 });
    expect(settler.settleDue).toHaveBeenLastCalledWith(5);
  });

  it("refuses a job it does not know", async () => {
    const { handler } = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(handler({ kind: "backstory" } as never)).rejects.toThrow("unknown job backstory");
  });
});
