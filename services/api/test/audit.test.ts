import { describe, expect, it, vi } from "vitest";
import { Audits, type AuditStore } from "../src/audit.js";

const NOW = Date.parse("2026-10-28T10:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe("the audit service", () => {
  it("reads a month of opens, and issues and stories a week further back", async () => {
    const store: AuditStore = {
      readAudit: vi.fn(async () => ({
        firstOpen: daysAgo(19),
        senders: [
          {
            senderId: "sA",
            senderKey: "a@example.test",
            publication: "Alpha",
            muted: false,
            mustRead: false,
            up: 0,
            down: 0,
            issueCount: 1,
            lastSeenAt: daysAgo(1),
          },
        ],
        issues: [
          { id: "a1", senderId: "sA", receivedAt: daysAgo(1) },
          { id: "a0", senderId: "sA", receivedAt: daysAgo(25) },
        ],
        stories: [],
        opened: ["a1"],
      })),
    };
    const r = await new Audits(store, () => NOW).audit();
    expect(store.readAudit).toHaveBeenCalledWith({
      issues: daysAgo(37),
      stories: daysAgo(37),
      opened: daysAgo(30),
    });
    // The window starts at the first open: the issue from before it is not counted.
    expect(r).toMatchObject({ from: daysAgo(19), days: 19 });
    expect(r.cards).toMatchObject([{ senderId: "sA", issues: 1, opened: 1, verdict: "new" }]);
  });
});
