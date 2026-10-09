import { describe, expect, it } from "vitest";
import type { ProcessedMessage } from "@library/core";
import { ingest } from "../src/ingest.js";
import type { Gmail, GmailRawMessage } from "../src/gmail.js";
import type { Store } from "../src/store.js";
import * as f from "../../../packages/core/test/fixtures.js";

type Inbox = Record<string, { raw: Buffer; labelIds: string[] } | "boom">;

function fakes(messages: Inbox) {
  const stored = new Map<string, ProcessedMessage>();
  const gmail = {
    listMessageIds: async () => Object.keys(messages),
    getRaw: async (id: string): Promise<GmailRawMessage> => {
      const m = messages[id];
      if (!m || m === "boom") throw new Error("gmail 500");
      return { id, raw: m.raw, labelIds: m.labelIds, internalDate: "1791700000000" };
    },
  } as unknown as Gmail;
  const store = {
    existingIds: async (ids: string[]) => new Set(ids.filter((id) => stored.has(id))),
    putNewsletter: async (p: ProcessedMessage) => void stored.set(p.id, p),
    putFiltered: async (p: ProcessedMessage) => void stored.set(p.id, p),
  } as unknown as Store;
  return { gmail, store, stored };
}

const inbox: Inbox = {
  a: { raw: f.substackByteByteGo, labelIds: ["INBOX"] },
  b: { raw: f.githubNoise, labelIds: [f.LABEL_NEWSLETTERS] },
  c: { raw: f.platformerLabeled, labelIds: [f.LABEL_NEWSLETTERS] },
  d: { raw: f.randomSubstack, labelIds: ["INBOX"] },
};

describe("ingest loop", () => {
  it("stores newsletters and filtered markers, then dedupes on rerun", async () => {
    const { gmail, store, stored } = fakes(inbox);
    const first = await ingest(gmail, store, { newerThanDays: 3 });
    expect(first).toMatchObject({
      listed: 4,
      alreadyStored: 0,
      newsletters: 2,
      filtered: 2,
      errors: 0,
    });
    expect(stored.get("b")?.kind).toBe("filtered");
    expect(stored.get("d")?.kind).toBe("filtered");

    const second = await ingest(gmail, store, { newerThanDays: 3 });
    expect(second).toMatchObject({ listed: 4, alreadyStored: 4, newsletters: 0, filtered: 0 });
  });

  it("keeps going when one message fails, and retries it next run", async () => {
    const { gmail, store, stored } = fakes({ ...inbox, e: "boom" });
    const stats = await ingest(gmail, store, { newerThanDays: 3 });
    expect(stats.errors).toBe(1);
    expect(stats.errorSamples[0]).toContain("e: gmail 500");
    expect(stats.newsletters).toBe(2);
    expect(stored.has("e")).toBe(false);
  });

  it("uses the look-back window in the Gmail query", async () => {
    const { gmail, store } = fakes({});
    const stats = await ingest(gmail, store, { newerThanDays: 28 });
    expect(stats.query).toMatch(/newer_than:28d$/);
  });
});
