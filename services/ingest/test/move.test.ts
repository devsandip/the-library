import { describe, expect, it } from "vitest";
import { kindOf, onTodaysKeys, ownersCopy } from "../../../scripts/move.js";

const owner = { id: "0f6c2b1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f" };
const P = `R#${owner.id}#`;

describe("the move's copies (#199)", () => {
  it("moves today's items, never a reader's copy, a reader's own items or the owner", () => {
    expect(onTodaysKeys({ pk: "ISSUE#a", sk: "META" })).toBe(true);
    expect(onTodaysKeys({ pk: "STATE", sk: "INGEST" })).toBe(true);
    expect(onTodaysKeys({ pk: "CONFIG", sk: "TOPICS" })).toBe(true);
    expect(onTodaysKeys({ pk: `${P}ISSUE#a`, sk: "META" })).toBe(false);
    expect(onTodaysKeys({ pk: `READER#${owner.id}`, sk: "SETTINGS" })).toBe(false);
    expect(onTodaysKeys({ pk: "CONFIG", sk: "OWNER" })).toBe(false);
  });

  it("puts the owner's prefix on the partition key and every index partition, nothing else", () => {
    const issue = {
      pk: "ISSUE#a",
      sk: "META",
      id: "a",
      gsi1pk: "INBOX",
      gsi1sk: "2026#a",
      gsi2pk: "UNREAD",
      gsi3pk: "SENDER#s1",
      gsi4pk: "RATED",
      vector: new Uint8Array([1, 2]),
    };
    expect(ownersCopy(issue, owner)).toEqual({
      ...issue,
      pk: `${P}ISSUE#a`,
      gsi1pk: `${P}INBOX`,
      gsi2pk: `${P}UNREAD`,
      gsi3pk: `${P}SENDER#s1`,
      gsi4pk: `${P}RATED`,
    });
  });

  it("says 'reader' where a move of Sandip's said 'sandip' (#181), and leaves Jev's alone", () => {
    expect(
      ownersCopy({ pk: "ISSUE#a", sk: "STORY#01", shelfSetBy: "sandip" }, owner).shelfSetBy,
    ).toBe("reader");
    expect(ownersCopy({ pk: "PREDICTIONS", sk: "a#01", setBy: "sandip" }, owner).setBy).toBe(
      "reader",
    );
    expect(ownersCopy({ pk: "ISSUE#a", sk: "STORY#02", shelfSetBy: "jev" }, owner).shelfSetBy).toBe(
      "jev",
    );
  });

  it("counts items by kind", () => {
    expect(kindOf({ pk: "ISSUE#a", sk: "STORY#01" })).toBe("ISSUE STORY");
    expect(kindOf({ pk: "ISSUE#a", sk: "META" })).toBe("ISSUE META");
    expect(kindOf({ pk: "SENDER#s1", sk: "META" })).toBe("SENDER");
    expect(kindOf({ pk: "TIMELINE#e", sk: "META" })).toBe("TIMELINE");
  });
});
