import { describe, expect, it, vi } from "vitest";
import type { Reader } from "@library/core/reader";
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
  const workFor = vi.fn((_reader?: Reader) => ({ checker, settler }));
  const owner = vi.fn(async (): Promise<Reader | undefined> => ({ id: "owner-1" }));
  return { checker, settler, workFor, owner, handler: createJobHandler(workFor, owner) };
}

describe("jobs", () => {
  it("runs a source check for the reader who asked for it (#179)", async () => {
    const { workFor, handler } = setup();
    await handler({ kind: "source", id: "tldr", n: 2, reader: "reader-1" });
    expect(workFor).toHaveBeenLastCalledWith({ id: "reader-1" });
    await handler({ kind: "source", id: "tldr", n: 2 });
    expect(workFor).toHaveBeenLastCalledWith(undefined);
  });

  it("runs a source check, and throws what it throws so the Lambda counts the error", async () => {
    const { checker, handler } = setup();
    await handler({ kind: "source", id: "tldr", n: 2 });
    expect(checker.check).toHaveBeenCalledWith("tldr", 2);

    checker.check.mockRejectedValueOnce(new Error("bedrock down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(handler({ kind: "source", id: "tldr", n: 2 })).rejects.toThrow("bedrock down");
  });

  it("settles for the owner (#180), or for the one library while none is named", async () => {
    const { workFor, owner, handler } = setup();
    await handler({ kind: "settle" });
    expect(workFor).toHaveBeenLastCalledWith({ id: "owner-1" });
    owner.mockResolvedValueOnce(undefined);
    await handler({ kind: "settle" });
    expect(workFor).toHaveBeenLastCalledWith(undefined);
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
