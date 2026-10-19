import { describe, expect, it } from "vitest";
import type { IssueListItem } from "@library/core/types";
import { undoOf } from "../src/actions.js";

describe("undoOf", () => {
  it("puts back the rating, the state and the saved state together (rule 4)", () => {
    const issue = {
      state: "read",
      savedAt: "2026-10-10T10:00:00.000Z",
      shelf: "news",
    } as IssueListItem;
    expect(undoOf(issue, { state: "archived", savedAt: undefined })).toEqual({
      state: "read",
      savedAt: "2026-10-10T10:00:00.000Z",
    });
    expect(undoOf({ ...issue, rating: -1 }, { rating: 1 })).toEqual({ rating: -1 });
    expect(undoOf(issue, { shelf: "learning" })).toEqual({ shelf: "news" });
  });
});
