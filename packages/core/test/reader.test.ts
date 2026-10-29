import { describe, expect, it } from "vitest";
import { groupsOf, OPERATORS_GROUP, readerOf } from "../src/reader.js";

describe("readerOf", () => {
  it("takes a Cognito sub or a test reader's name, and nothing else", () => {
    expect(readerOf("4f1c2d3e-aaaa-bbbb-cccc-1234567890ab")).toEqual({
      id: "4f1c2d3e-aaaa-bbbb-cccc-1234567890ab",
    });
    expect(readerOf("int-test")).toEqual({ id: "int-test" });
    expect(readerOf("a/b")).toBeUndefined();
    expect(readerOf(undefined)).toBeUndefined();
  });
});

describe("groupsOf (#224)", () => {
  it("reads the groups claim as API Gateway passes it, or as an array", () => {
    expect(groupsOf("[operators]")).toEqual([OPERATORS_GROUP]);
    expect(groupsOf("[operators readers]")).toEqual(["operators", "readers"]);
    expect(groupsOf("operators")).toEqual(["operators"]);
    expect(groupsOf(["operators", 3])).toEqual(["operators"]);
  });

  it("finds none in a missing or empty claim", () => {
    expect(groupsOf(undefined)).toEqual([]);
    expect(groupsOf("")).toEqual([]);
    expect(groupsOf("[]")).toEqual([]);
  });
});
