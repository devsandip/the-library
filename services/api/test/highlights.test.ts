import { describe, expect, it, vi } from "vitest";
import type { Highlight, IssueListItem } from "@library/core/types";
import { HttpError } from "../src/errors.js";
import { Highlights, type HighlightStore } from "../src/highlights.js";

const row = (id: string): IssueListItem => ({
  id,
  senderId: "s0123456789ab",
  publication: "Platformer",
  subject: `Issue ${id}`,
  snippet: "",
  receivedAt: "2026-10-28T02:00:00.000Z",
  readMinutes: 5,
  state: "read",
});

const kept = (issueId: string, key: string, over: Partial<Highlight> = {}): Highlight => ({
  id: `${issueId}.${key}`,
  issueId,
  exact: "A passage.",
  prefix: "",
  suffix: "",
  createdAt: "2026-10-29T05:00:00.000Z",
  ...over,
});

function fakeStore(over: Partial<HighlightStore> = {}): HighlightStore {
  return {
    listItems: vi.fn(async (ids: string[]) => ids.filter((id) => id !== "gone").map(row)),
    issueHighlights: vi.fn(async () => []),
    putHighlight: vi.fn(async () => undefined),
    setHighlightNote: vi.fn(async (id: string, note: string | undefined, at: string) =>
      id.startsWith("i1.") ? kept("i1", id.slice(3), { note, updatedAt: at }) : undefined,
    ),
    deleteHighlight: vi.fn(async () => undefined),
    listHighlights: vi.fn(async () => ({ items: [] })),
    ...over,
  };
}

const NOW = Date.parse("2026-10-29T05:30:00.000Z");

describe("Highlights", () => {
  it("keeps a new passage with a time-sorted id and its note", async () => {
    const store = fakeStore();
    const h = await new Highlights(
      store,
      () => NOW,
      () => 0,
    ).add("i1", { exact: "The model ships.", prefix: "said: ", suffix: " It is" }, "Check.");
    expect(h).toEqual({
      id: `i1.${NOW.toString(36)}0000`,
      issueId: "i1",
      exact: "The model ships.",
      prefix: "said: ",
      suffix: " It is",
      note: "Check.",
      createdAt: "2026-10-29T05:30:00.000Z",
    });
    expect(store.putHighlight).toHaveBeenCalledWith(h);
  });

  it("answers the one kept when the same passage in the same place comes again", async () => {
    const first = kept("i1", "mh0abcd10000", { exact: "Again", prefix: "said ", suffix: "." });
    const store = fakeStore({ issueHighlights: vi.fn(async () => [first]) });
    const svc = new Highlights(store, () => NOW);
    expect(await svc.add("i1", { exact: "Again", prefix: "said ", suffix: "." })).toBe(first);
    expect(store.putHighlight).not.toHaveBeenCalled();
    // The same words elsewhere in the issue are a highlight of their own.
    await svc.add("i1", { exact: "Again", prefix: "and ", suffix: "!" });
    expect(store.putHighlight).toHaveBeenCalledTimes(1);
  });

  it("404s an issue that is unknown or filtered", async () => {
    const err = await new Highlights(fakeStore())
      .add("gone", { exact: "x", prefix: "", suffix: "" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(404);
  });

  it("sets and clears a note, and 404s an unknown highlight", async () => {
    const store = fakeStore();
    const svc = new Highlights(store, () => NOW);
    expect((await svc.note("i1.mh0abcd10000", "Mine.")).note).toBe("Mine.");
    expect(store.setHighlightNote).toHaveBeenCalledWith(
      "i1.mh0abcd10000",
      "Mine.",
      "2026-10-29T05:30:00.000Z",
    );
    const err = await svc.note("i9.mh0abcd10000", undefined).catch((e: unknown) => e);
    expect((err as HttpError).status).toBe(404);
  });

  it("lists a page with each highlight's issue, leaving out ones whose issue is gone", async () => {
    const items = [kept("i2", "b"), kept("gone", "x"), kept("i1", "a"), kept("i2", "c")];
    const store = fakeStore({ listHighlights: vi.fn(async () => ({ items, next: "cursor" })) });
    const page = await new Highlights(store).list(4, "before");
    expect(store.listHighlights).toHaveBeenCalledWith(4, "before");
    expect(store.listItems).toHaveBeenCalledWith(["i2", "gone", "i1"]);
    expect(page.items.map((h) => [h.id, h.issue.id])).toEqual([
      ["i2.b", "i2"],
      ["i1.a", "i1"],
      ["i2.c", "i2"],
    ]);
    expect(page.next).toBe("cursor");
    expect(await new Highlights(fakeStore()).list(10)).toEqual({ items: [] });
  });
});
