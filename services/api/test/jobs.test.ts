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
  const zones: Record<string, string> = { ny: "America/New_York", in: "Asia/Kolkata" };
  const readers = vi.fn(async (): Promise<(Reader | undefined)[]> => [{ id: "ny" }, { id: "in" }]);
  const timeZoneOf = vi.fn(async (r?: Reader) => (r ? zones[r.id]! : "Asia/Kolkata"));
  return {
    checker,
    settler,
    workFor,
    owner,
    readers,
    handler: createJobHandler(workFor, { owner, readers, timeZoneOf }),
  };
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

  it("settles each reader whose clock reads 07:xx in the hourly round, and no one else (#211)", async () => {
    const { workFor, readers, handler } = setup();
    // 11:30 UTC is 07:30 in New York (summer time) and 17:00 in India.
    expect(await handler({ kind: "daily", at: "2026-10-29T11:30:00.000Z" })).toEqual({
      at: "2026-10-29T11:30:00.000Z",
      settled: [{ reader: "ny", stats }],
    });
    expect(workFor).toHaveBeenLastCalledWith({ id: "ny" });
    // 02:00 UTC is 07:30 in India.
    const india = await handler({ kind: "daily", at: "2026-10-29T02:00:00.000Z" });
    expect(india).toMatchObject({ settled: [{ reader: "in" }] });
    // The one library on today's keys: no reader, India's 07:00 as before.
    readers.mockResolvedValueOnce([undefined]);
    expect(await handler({ kind: "daily", at: "2026-10-29T02:00:00.000Z" })).toMatchObject({
      settled: [{ stats }],
    });
  });
});
