import { describe, expect, it } from "vitest";
import {
  audit,
  auditWindow,
  suggest,
  type AuditIssue,
  type AuditNumbers,
  type AuditStory,
} from "../src/audit.js";
import type { SenderListItem } from "../src/types.js";

const NOW = Date.parse("2026-10-28T10:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const sender = (senderId: string, publication: string, o: Partial<SenderListItem> = {}) => ({
  senderId,
  senderKey: `${publication.toLowerCase()}@example.test`,
  publication,
  muted: false,
  mustRead: false,
  up: 0,
  down: 0,
  issueCount: 0,
  lastSeenAt: daysAgo(0),
  ...o,
});

const numbers = (o: Partial<AuditNumbers> = {}): AuditNumbers => ({
  muted: false,
  mustRead: false,
  issues: 10,
  opened: 5,
  useful: 0,
  notUseful: 0,
  stories: 20,
  repeats: 2,
  ...o,
});

describe("the audit's window", () => {
  it("is the last 30 days", () => {
    expect(auditWindow(NOW)).toEqual({ from: daysAgo(30), to: daysAgo(0) });
    expect(auditWindow(NOW, daysAgo(45))).toEqual({ from: daysAgo(30), to: daysAgo(0) });
  });

  it("starts no earlier than the first open logged, since earlier reads are unknown", () => {
    expect(auditWindow(NOW, daysAgo(18)).from).toBe(daysAgo(18));
    expect(auditWindow(NOW, daysAgo(-1)).from).toBe(daysAgo(0));
  });
});

describe("the suggestion", () => {
  it("always keeps Must Read, and suggests dropping what is muted", () => {
    expect(suggest(numbers({ mustRead: true, opened: 0, notUseful: 9 }))).toEqual({
      verdict: "keep",
      reason: "mustRead",
    });
    expect(suggest(numbers({ muted: true, issues: 1 }))).toEqual({
      verdict: "drop",
      reason: "muted",
    });
  });

  it("waits with fewer than 4 issues", () => {
    expect(suggest(numbers({ issues: 3, opened: 0 }))).toEqual({ verdict: "new", reason: "few" });
    expect(suggest(numbers({ issues: 4, opened: 0 })).verdict).toBe("drop");
  });

  it("drops what is rated not useful more often than useful, twice at least", () => {
    expect(suggest(numbers({ notUseful: 2, useful: 1 }))).toEqual({
      verdict: "drop",
      reason: "notUseful",
    });
    expect(suggest(numbers({ notUseful: 1 })).verdict).toBe("keep");
    expect(suggest(numbers({ notUseful: 2, useful: 2 }))).toEqual({
      verdict: "keep",
      reason: "useful",
    });
  });

  it("drops what is hardly opened and never rated useful", () => {
    expect(suggest(numbers({ issues: 20, opened: 1 }))).toEqual({
      verdict: "drop",
      reason: "unopened",
    });
    expect(suggest(numbers({ issues: 20, opened: 2 }))).toEqual({
      verdict: "keep",
      reason: "opened",
    });
    expect(suggest(numbers({ issues: 20, opened: 0, useful: 1 }))).toEqual({
      verdict: "keep",
      reason: "useful",
    });
  });

  it("drops what mostly repeats stories another newsletter carried first", () => {
    expect(suggest(numbers({ stories: 10, repeats: 6 }))).toEqual({
      verdict: "drop",
      reason: "repeats",
    });
    expect(suggest(numbers({ stories: 10, repeats: 5 })).verdict).toBe("keep");
    // Too few stories to say, or rated useful anyway.
    expect(suggest(numbers({ stories: 7, repeats: 7 })).verdict).toBe("keep");
    expect(suggest(numbers({ stories: 10, repeats: 9, useful: 1 })).verdict).toBe("keep");
  });
});

describe("the audit", () => {
  const senders = [
    sender("sA", "Alpha", { unsubscribeUrl: "https://alpha.test/unsub" }),
    sender("sB", "Beta"),
    sender("sC", "Gamma", { muted: true }),
    sender("sD", "Delta"),
  ];
  const issue = (id: string, senderId: string, d: number, o: Partial<AuditIssue> = {}) => ({
    id,
    senderId,
    receivedAt: daysAgo(d),
    ...o,
  });
  const story = (id: string, n: number, senderId: string, d: number, eventId?: string) =>
    ({
      id,
      n,
      senderId,
      receivedAt: daysAgo(d),
      headline: `${id} story ${n}`,
      ...(eventId ? { eventId } : {}),
    }) satisfies AuditStory;

  const issues: AuditIssue[] = [
    issue("a1", "sA", 2, { rating: 1 }),
    issue("a2", "sA", 5, { promo: true }),
    issue("a3", "sA", 9, { rating: -1 }),
    issue("a4", "sA", 12),
    issue("a-old", "sA", 31, { rating: -1 }),
    issue("b1", "sB", 1),
    issue("b2", "sB", 4),
    issue("b3", "sB", 6),
    issue("b4", "sB", 8),
    issue("c1", "sC", 3),
    issue("d1", "sD", 7),
    issue("b-lead", "sB", 33),
  ];
  const stories: AuditStory[] = [
    // e1: Alpha first, Beta a day later.
    story("a1", 1, "sA", 2, "e1"),
    story("b1", 1, "sB", 1, "e1"),
    // e2: only Alpha. e3: only Alpha, and muted Gamma, which Sandip never sees.
    story("a3", 1, "sA", 9, "e2"),
    story("a4", 1, "sA", 12, "e3"),
    story("c1", 1, "sC", 3, "e3"),
    // e4: Delta first, Beta later three times; e5: Alpha before the window, Beta inside it.
    story("d1", 1, "sD", 7, "e4"),
    story("b1", 2, "sB", 1, "e4"),
    story("b2", 1, "sB", 4, "e4"),
    story("b3", 1, "sB", 6, "e4"),
    story("b-lead", 1, "sB", 33, "e6"),
    story("a-old", 1, "sA", 31, "e5"),
    story("b4", 1, "sB", 8, "e5"),
    // Not linked yet: not counted.
    story("b3", 2, "sB", 6),
  ];
  const r = audit(NOW, { firstOpen: daysAgo(60), senders, issues, stories, opened: ["a1", "b2"] });
  const card = (id: string) => r.cards.find((c) => c.senderId === id)!;

  it("counts each newsletter's issues, opens and ratings inside the window", () => {
    expect(r).toMatchObject({ from: daysAgo(30), to: daysAgo(0), days: 30 });
    expect(card("sA")).toMatchObject({
      publication: "Alpha",
      unsubscribeUrl: "https://alpha.test/unsub",
      issues: 4,
      promos: 1,
      opened: 1,
      useful: 1,
      notUseful: 1,
    });
    expect(card("sB")).toMatchObject({ issues: 4, opened: 1, useful: 0 });
  });

  it("counts stories another newsletter carried first, by whom, and what only it carried", () => {
    expect(card("sA")).toMatchObject({ stories: 3, repeats: 0, only: 2 });
    // The latest first; a story a muted newsletter also carried is still its own.
    expect(card("sA").onlyHeadlines).toEqual([
      { issueId: "a3", n: 1, headline: "a3 story 1" },
      { issueId: "a4", n: 1, headline: "a4 story 1" },
    ]);
    // Alpha carried e1 and, before the window, e5 first; Delta carried e4 first, for three.
    expect(card("sB")).toMatchObject({ stories: 5, repeats: 5, only: 0 });
    expect(card("sB").firstBy).toEqual({ senderId: "sD", publication: "Delta", stories: 3 });
    expect(card("sD")).toMatchObject({ stories: 1, repeats: 0, only: 0 });
    expect(card("sD").firstBy).toBeUndefined();
  });

  it("takes a story's newsletter from its issue, as senders are re-keyed", () => {
    const moved = audit(NOW, {
      senders,
      issues: [issue("x1", "sD", 2), issue("x2", "sD", 3)],
      stories: [story("x1", 1, "sOld", 2, "e9"), story("x2", 1, "sB", 3, "e9")],
      opened: [],
    });
    expect(moved.cards[0]).toMatchObject({ senderId: "sD", stories: 2, repeats: 0, only: 2 });
  });

  it("lists worth dropping first, then kept, then too new, most issues first", () => {
    expect(r.cards.map((c) => [c.publication, c.verdict, c.reason])).toEqual([
      ["Gamma", "drop", "muted"],
      ["Alpha", "keep", "useful"],
      ["Beta", "keep", "opened"],
      ["Delta", "new", "few"],
    ]);
  });

  it("leaves out newsletters with no issues in the window", () => {
    const later = audit(NOW, { firstOpen: daysAgo(1), senders, issues, stories, opened: [] });
    expect(later.days).toBe(1);
    expect(later.cards.map((c) => c.publication)).toEqual(["Beta"]);
  });
});
