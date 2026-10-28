import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceCheck, SourceResponse } from "@library/core/types";
import type { LibraryApi } from "../src/api.js";
import { checkSource, sourceState } from "../src/timeline.js";

const check: SourceCheck = {
  url: "https://example.com/post",
  verdict: "holds",
  claims: [{ claim: "It shipped.", source: "It shipped.", verdict: "holds" }],
  at: "2026-10-28T03:00:00.000Z",
  ms: 5000,
  cents: 0.6,
};

/** An API whose source check runs in the background: GET answers each of `reads` in turn. */
function api(post: SourceResponse, reads: SourceResponse[]) {
  const source = vi.fn(async () => reads.shift() ?? {});
  const checkSourceCall = vi.fn(async () => post);
  return { api: { source, checkSource: checkSourceCall } as unknown as LibraryApi, source };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe("the source check (#23)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("follows a run in the background until its check is kept", async () => {
    const running = { running: { since: "2026-10-28T03:00:00.000Z" } };
    const { api: a, source } = api(running, [running, { check }]);
    checkSource(a, "run-kept", 1);
    await settle();
    expect(sourceState("run-kept", 1).status).toBe("writing");
    await vi.advanceTimersByTimeAsync(2000);
    expect(source).toHaveBeenCalledTimes(1);
    expect(sourceState("run-kept", 1).status).toBe("writing");
    await vi.advanceTimersByTimeAsync(2000);
    expect(sourceState("run-kept", 1)).toEqual({ status: "kept", value: check });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("carries the pages a running check has read into its state (#129)", async () => {
    const since = "2026-10-28T03:00:00.000Z";
    const pages = [{ url: "https://news.test/story" }];
    const { api: a } = api({ running: { since } }, [
      { running: { since, pages, reading: "https://lab.test/post" } },
      { check },
    ]);
    checkSource(a, "run-pages", 1);
    await settle();
    const started = sourceState("run-pages", 1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sourceState("run-pages", 1)).toEqual({
      status: "writing",
      // The clock keeps counting from when Run was tapped.
      since: (started as { since: number }).since,
      run: { pages, reading: "https://lab.test/post" },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(sourceState("run-pages", 1).status).toBe("kept");
  });

  it("says why when the run keeps nothing, and answers at once when there is no link", async () => {
    const none = "The source could not be read: the page answered 403.";
    const ran = api({ running: { since: "2026-10-28T03:00:00.000Z" } }, [{ none }]);
    checkSource(ran.api, "run-none", 1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sourceState("run-none", 1)).toEqual({ status: "idle", none });

    const noLink = api({ none: "This story has no source link to check." }, []);
    checkSource(noLink.api, "no-link", 1);
    await settle();
    expect(sourceState("no-link", 1)).toEqual({
      status: "idle",
      none: "This story has no source link to check.",
    });
    expect(noLink.source).not.toHaveBeenCalled();
  });

  it("gives up after four minutes of running, with a retry that reads again", async () => {
    const running = { running: { since: "2026-10-28T03:00:00.000Z" } };
    const { api: a } = api(
      running,
      Array.from({ length: 200 }, () => running),
    );
    checkSource(a, "run-long", 1);
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 2000);
    expect(sourceState("run-long", 1)).toMatchObject({ status: "error", retry: "read" });
  });
});
