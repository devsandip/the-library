import { describe, expect, it } from "vitest";
import { readSearch, searchHref } from "../src/filters.js";

describe("search in the URL (#53)", () => {
  it("keeps the query, the order and the open issue, and leaves defaults out", () => {
    const href = searchHref({ q: "rate cut & Fed", sort: "newest", issue: "abc" });
    expect(href).toBe("/search?q=rate+cut+%26+Fed&sort=newest&issue=abc");
    const query = Object.fromEntries(new URL(href, "https://x.test").searchParams);
    expect(readSearch(query)).toEqual({ q: "rate cut & Fed", sort: "newest", issue: "abc" });
    expect(searchHref({ q: "kafka", sort: "best" })).toBe("/search?q=kafka");
    expect(searchHref({ q: "" })).toBe("/search");
  });

  it("reads anything but newest as best match", () => {
    expect(readSearch({ q: "x", sort: "oldest" })).toEqual({
      q: "x",
      sort: "best",
      issue: undefined,
    });
    expect(readSearch({})).toEqual({ q: "", sort: "best", issue: undefined });
  });
});
