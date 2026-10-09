import { describe, expect, it } from "vitest";
import { senderIdentity } from "@library/core";
import { describePlan, planSenders, type StoredIssue, type StoredSender } from "../src/senders.js";

const sid = (addr: string, name = "") => senderIdentity(addr, name).senderId;
const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T06:00:00.000Z`;

/** A sender item exactly as the rebuild would write it for `issues`. */
function senderFor(issues: StoredIssue[], extra: Partial<StoredSender> = {}): StoredSender {
  const plan = planSenders(issues, []);
  const c = plan.creates[0]!;
  return { ...c, ...extra };
}

describe("planSenders", () => {
  // Before the split rule, every TLDR edition shared one sender keyed by the bare address.
  const legacyTldr = sid("dan@tldrnewsletter.com");
  const tldrIssues: StoredIssue[] = [
    {
      id: "a",
      senderId: legacyTldr,
      publication: "TLDR Dev",
      fromAddr: "dan@tldrnewsletter.com",
      fromName: "TLDR Dev",
      receivedAt: at(2),
    },
    {
      // Stored before From names were kept: the publication stands in for it.
      id: "b",
      senderId: legacyTldr,
      publication: "TLDR IT",
      fromAddr: "dan@tldrnewsletter.com",
      receivedAt: at(3),
      rating: 1,
    },
  ];
  const legacySender: StoredSender = {
    senderId: legacyTldr,
    senderKey: "dan@tldrnewsletter.com",
    publication: "TLDR Fintech",
    muted: true,
    mustRead: true,
    up: 1,
    down: 0,
    issueCount: 2,
    addresses: ["dan@tldrnewsletter.com"],
    lastSeenAt: at(3),
  };

  it("splits a merged sender by From name, carrying ratings and flags", () => {
    const plan = planSenders(tldrIssues, [legacySender]);
    expect(plan.rekeys).toEqual([
      {
        id: "a",
        fromSenderId: legacyTldr,
        toSenderId: sid("dan@tldrnewsletter.com", "TLDR Dev"),
        publication: "TLDR Dev",
      },
      {
        id: "b",
        fromSenderId: legacyTldr,
        toSenderId: sid("dan@tldrnewsletter.com", "TLDR IT"),
        publication: "TLDR IT",
      },
    ]);
    expect(plan.creates).toHaveLength(2);
    expect(plan.creates.find((c) => c.publication === "TLDR IT")).toMatchObject({
      senderKey: "dan@tldrnewsletter.com#tldr-it",
      issueCount: 1,
      up: 1,
      down: 0,
      muted: true, // both flags inherited from the merged sender
      mustRead: true,
      lastSeenAt: at(3),
    });
    expect(plan.deletes.map((d) => d.senderId)).toEqual([legacyTldr]);
    expect(plan.updates).toEqual([]);
  });

  it("renames a sender by alias without changing its id", () => {
    const issue: StoredIssue = {
      id: "c",
      senderId: sid("casey@platformer.news"),
      publication: "Casey Newton",
      fromAddr: "casey@platformer.news",
      receivedAt: at(1),
    };
    const sender = { ...senderFor([issue]), publication: "Casey Newton" };
    const plan = planSenders([issue], [sender]);
    expect(plan.rekeys).toEqual([
      {
        id: "c",
        fromSenderId: sender.senderId,
        toSenderId: sender.senderId,
        publication: "Platformer",
      },
    ]);
    expect(plan.creates).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(describePlan(plan, 1, 1)).toMatchObject({
      renamed: ["Casey Newton -> Platformer"],
      recounted: [],
      sendersAfter: 1,
    });
  });

  it("recounts issues, ratings, last seen and unsubscribe link from the issues", () => {
    const base = {
      senderId: sid("hello@example.test"),
      publication: "Example",
      fromAddr: "hello@example.test",
    };
    const issues: StoredIssue[] = [
      {
        ...base,
        id: "d1",
        receivedAt: at(1),
        fromName: "Example",
        unsubscribeUrl: "https://example.test/u/old",
      },
      { ...base, id: "d2", receivedAt: at(5), fromName: "Example", rating: -1 },
      {
        ...base,
        id: "d3",
        receivedAt: at(4),
        fromName: "Example",
        unsubscribeUrl: "https://example.test/u/new",
      },
    ];
    const stale = {
      ...senderFor(issues),
      issueCount: 7,
      down: 0,
      lastSeenAt: at(2),
      unsubscribeUrl: undefined,
    };
    const plan = planSenders(issues, [stale]);
    expect(plan.rekeys).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]!.next).toMatchObject({
      issueCount: 3,
      down: 1,
      lastSeenAt: at(5),
      unsubscribeUrl: "https://example.test/u/new", // latest issue that has one
    });
    expect(describePlan(plan, 3, 1).recounted).toEqual([
      "Example: issueCount, down, lastSeenAt, unsubscribeUrl",
    ]);
  });

  it("is a no-op when senders already match their issues", () => {
    const issues: StoredIssue[] = [
      {
        id: "e",
        senderId: sid("dan@tldrnewsletter.com", "TLDR AI"),
        publication: "TLDR AI",
        fromAddr: "dan@tldrnewsletter.com",
        fromName: "TLDR AI",
        receivedAt: at(1),
      },
    ];
    const plan = planSenders(issues, [senderFor(issues, { muted: false, mustRead: false })]);
    expect(plan).toEqual({ rekeys: [], creates: [], updates: [], deletes: [], unchanged: 1 });
  });
});
