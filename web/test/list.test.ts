import { describe, expect, it } from "vitest";
import { steady } from "../src/list.js";

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const of = (...xs: string[]) => xs.map((id) => ({ id }));

describe("steady: rows keep their place (RET-10)", () => {
  it("keeps a row the fresh list dropped where it was", () => {
    const { items, kept } = steady(of("a", "b", "c", "d"), of("a", "c", "d"));
    expect(ids(items)).toEqual(["a", "b", "c", "d"]);
    expect([...kept]).toEqual(["b"]);
  });

  it("keeps a dropped first row first, and several in order", () => {
    expect(ids(steady(of("a", "b", "c", "d"), of("c", "d")).items)).toEqual(["a", "b", "c", "d"]);
    expect(ids(steady(of("a", "b", "c"), of("a")).items)).toEqual(["a", "b", "c"]);
  });

  it("lets new rows in at their own place", () => {
    expect(ids(steady(of("a", "b"), of("new", "a")).items)).toEqual(["new", "a", "b"]);
  });

  it("takes the fresh copy of a row both lists hold", () => {
    const { items } = steady([{ id: "a", v: 1 }], [{ id: "a", v: 2 }]);
    expect(items).toEqual([{ id: "a", v: 2 }]);
  });

  it("starts from the fresh list when there is nothing before", () => {
    expect(ids(steady([], of("a", "b")).items)).toEqual(["a", "b"]);
  });
});
