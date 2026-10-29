import { describe, expect, it } from "vitest";
import {
  INGEST_STATE_KEY,
  issueIndexAttributes,
  issueKey,
  keysFor,
  OWNER_KEY,
  PARTITION,
  settingsKey,
} from "../src/keys.js";

const issue = {
  id: "abc",
  senderId: "s0123456789ab",
  receivedAt: "2026-10-29T00:00:00.000Z",
  state: "unread" as const,
  rating: 1 as const,
  ratedAt: "2026-10-29T01:00:00.000Z",
};

describe("keys bound to a reader (#195)", () => {
  const today = keysFor();
  const r = keysFor("0f6c2b1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f");

  it("are today's keys without a reader", () => {
    expect(today.issue("abc")).toEqual(issueKey("abc"));
    expect(today.ingestState).toEqual(INGEST_STATE_KEY);
    expect(today.partition).toEqual(PARTITION);
    expect(today.issueIndex(issue)).toEqual(issueIndexAttributes(issue));
  });

  it("put the reader in front of every partition key, sort keys unchanged", () => {
    const p = "R#0f6c2b1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f#";
    expect(r.issue("abc")).toEqual({ pk: `${p}ISSUE#abc`, sk: "META" });
    expect(r.story("abc", 3)).toEqual({ pk: `${p}ISSUE#abc`, sk: "STORY#03" });
    expect(r.ingestState).toEqual({ pk: `${p}STATE`, sk: "INGEST" });
    expect(r.topics).toEqual({ pk: `${p}CONFIG`, sk: "TOPICS" });
    expect(r.digest("2026-10-29").pk).toBe(`${p}DIGEST#2026-10-29`);
    expect(r.follow("e1")).toEqual({ pk: `${p}FOLLOWING`, sk: "e1" });
    expect(r.prediction("abc", 2)).toEqual({ pk: `${p}PREDICTIONS`, sk: "abc#02" });
    expect(r.predictionFromId("abc.2")).toEqual(r.prediction("abc", 2));
    expect(r.highlightFromId("abc.0000000aaaaa")?.pk).toBe(`${p}ISSUE#abc`);
    expect(r.source("abc", 1).pk).toBe(`${p}SOURCE#abc#01`);
    expect(r.timeline("e1").pk).toBe(`${p}TIMELINE#e1`);
  });

  it("and in front of every index partition, never on a sort key", () => {
    const p = r.prefix;
    const { set, remove } = r.issueIndex(issue);
    expect(set).toEqual({
      gsi1pk: `${p}INBOX`,
      gsi1sk: "2026-10-29T00:00:00.000Z#abc",
      gsi2pk: `${p}UNREAD`,
      gsi2sk: "2026-10-29T00:00:00.000Z#abc",
      gsi3pk: `${p}SENDER#s0123456789ab`,
      gsi3sk: "2026-10-29T00:00:00.000Z#abc",
      gsi4pk: `${p}RATED`,
      gsi4sk: "2026-10-29T01:00:00.000Z#abc",
    });
    expect(remove).toEqual([]);
    expect(r.partition.learning).toBe(`${p}LEARNING`);
    expect(r.senderPartition("s1")).toBe(`${p}SENDER#s1`);
    expect(r.openIndex("abc", "t").gsi1pk).toBe(`${p}OPENS`);
    expect(r.senderIndex("s1", "Pub").gsi1pk).toBe(`${p}SENDERS`);
    expect(r.highlightIndex("abc", "k", "t").gsi1pk).toBe(`${p}HIGHLIGHTS`);
  });

  it("read ids back only from the reader's own keys", () => {
    expect(r.issueIdOf(r.issue("abc").pk)).toBe("abc");
    expect(r.issueIdOf(issueKey("abc").pk)).toBeUndefined();
    expect(r.senderIdOf(r.senderItem("s1").pk)).toBe("s1");
    expect(r.owns(r.issue("abc").pk)).toBe(true);
    expect(r.owns(keysFor("someone-else").issue("abc").pk)).toBe(false);
  });

  it("leave the owner and readers' own items alone", () => {
    expect(OWNER_KEY.pk).toBe("CONFIG");
    expect(settingsKey("x").pk).toBe("READER#x");
  });
});
