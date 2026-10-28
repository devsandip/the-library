import { describe, expect, it, vi } from "vitest";
import type { AuditCard } from "@library/core/types";
import type { LibraryApi } from "../src/api.js";
import { auditState, dropCount, readAudit, setAuditMuted, withMuted } from "../src/audit.js";
import { countsLine, storiesLine, why } from "../src/pages/audit.js";

const card = (senderId: string, over: Partial<AuditCard> = {}): AuditCard => ({
  senderId,
  publication: `Pub ${senderId}`,
  muted: false,
  mustRead: false,
  issues: 10,
  promos: 0,
  opened: 4,
  useful: 0,
  notUseful: 0,
  stories: 0,
  repeats: 0,
  only: 0,
  onlyHeadlines: [],
  verdict: "keep",
  reason: "opened",
  ...over,
});

describe("why a card says what it says (#151)", () => {
  it("puts the reason in numbers", () => {
    expect(why(card("a", { reason: "unopened", opened: 1, issues: 14 }), 19)).toBe(
      "Opened 1 of 14 issues, and never rated useful.",
    );
    expect(why(card("a", { reason: "notUseful", notUseful: 3, useful: 1 }), 19)).toBe(
      "Rated not useful 3 times, useful once.",
    );
    expect(why(card("a", { reason: "repeats", repeats: 30, stories: 40 }), 19)).toBe(
      "30 of its 40 stories ran first elsewhere, and never rated useful.",
    );
    expect(why(card("a", { reason: "useful", useful: 2 }), 19)).toBe("Rated useful twice.");
    expect(why(card("a", { reason: "few", issues: 1 }), 1)).toBe(
      "1 issue in 1 day: too few to tell.",
    );
  });

  it("says when the star alone keeps a newsletter, and why it would otherwise go (#152)", () => {
    const starred = { mustRead: true, verdict: "keep", reason: "mustRead" } as const;
    expect(why(card("a", { ...starred, opened: 0, issues: 11 }), 19)).toBe(
      "Must Read: starred to keep, though otherwise worth dropping. Opened 0 of 11 issues, and never rated useful.",
    );
    expect(why(card("a", { ...starred, opened: 4 }), 19)).toBe("Must Read: starred to keep.");
    expect(why(card("a", { ...starred, opened: 0, issues: 3 }), 19)).toBe(
      "Must Read: starred to keep.",
    );
  });

  it("counts what it sent and what was done with it, leaving out what is none", () => {
    expect(countsLine(card("a", { promos: 2, opened: 6, useful: 2, notUseful: 1 }))).toBe(
      "10 issues · 2 promos · 6 opened · 2 ✓ · 1 ✕",
    );
    expect(countsLine(card("a", { issues: 1, opened: 0 }))).toBe("1 issue · 0 opened");
  });

  it("says who carried its stories first, and how many only it carried", () => {
    const firstBy = { senderId: "b", publication: "Beta", stories: 4 };
    expect(storiesLine(card("a", { stories: 10, repeats: 7, firstBy, only: 2 }))).toBe(
      "10 stories · 7 ran first elsewhere, 4 in Beta · 2 only here",
    );
    expect(storiesLine(card("a", { stories: 1, only: 1 }))).toBe("1 story · 1 only here");
    expect(storiesLine(card("a"))).toBeUndefined();
  });
});

describe("the audit store (#151)", () => {
  it("moves a card as it is muted, by the API's rules, and puts it back if the API says no", async () => {
    const kept = card("a", { opened: 4 });
    const starred = card("b", { mustRead: true, reason: "mustRead", issues: 3 });
    const api = {
      audit: vi.fn(async () => ({ from: "f", to: "t", days: 19, cards: [kept, starred] })),
      updateSender: vi.fn(async () => ({})),
    } as unknown as LibraryApi;
    await readAudit(api);
    expect(dropCount(auditState())).toBe(0);

    const muting = setAuditMuted(api, "a", true);
    const s = auditState();
    expect(s.status === "ok" && s.data.cards[0]).toMatchObject({
      senderId: "a",
      verdict: "drop",
      reason: "muted",
    });
    expect(dropCount(s)).toBe(1);
    await muting;
    expect(api.updateSender).toHaveBeenCalledWith("a", { muted: true });

    // Must Read stays kept even when muted.
    expect(withMuted(starred, true)).toMatchObject({ verdict: "keep", reason: "mustRead" });

    vi.mocked(api.updateSender).mockRejectedValueOnce(new Error("offline"));
    await expect(setAuditMuted(api, "b", true)).rejects.toThrow("offline");
    const after = auditState();
    expect(after.status === "ok" && after.data.cards.find((c) => c.senderId === "b")?.muted).toBe(
      false,
    );
  });
});
