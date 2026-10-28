/**
 * Subscription audit (#25, #151) as the app holds it: read when its page opens, kept for the
 * page's life so Library and ⌘K can say how many are worth dropping. Muting from a card moves its
 * suggestion at once; the audit is then read again, since a muted newsletter no longer counts as
 * having carried anything first.
 */
import { useEffect, useState } from "preact/hooks";
import { byVerdict, suggest } from "@library/core/audit";
import type { AuditCard, AuditResponse } from "@library/core/types";
import type { LibraryApi } from "./api.js";
import { useApp } from "./context.js";

export type AuditState =
  | { status: "loading" }
  | { status: "ok"; data: AuditResponse }
  | { status: "error"; error: string };

let state: AuditState = { status: "loading" };
let reading: Promise<void> | undefined;
const listeners = new Set<() => void>();

function put(next: AuditState) {
  state = next;
  for (const l of listeners) l();
}

export const auditState = () => state;

/** How many are worth dropping, once the audit has been read. */
export const dropCount = (s: AuditState) =>
  s.status === "ok" ? s.data.cards.filter((c) => c.verdict === "drop").length : undefined;

/** Reads the audit again; what is on screen stays meanwhile. */
export function readAudit(api: LibraryApi): Promise<void> {
  reading ??= api
    .audit()
    .then(
      (data) => put({ status: "ok", data }),
      (err: Error) => {
        if (state.status !== "ok") put({ status: "error", error: err.message });
      },
    )
    .finally(() => (reading = undefined));
  return reading;
}

/**
 * The audit: read again each time (its page opening), only if not read yet (Library), or never
 * (⌘K, which shows the count only once the page has been opened, so the console never reads a
 * month of the archive just to start).
 */
export function useAudit(read: "again" | "once" | "never" = "again"): {
  state: AuditState;
  reload: () => Promise<void>;
} {
  const { api } = useApp();
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    if (read === "again" || (read === "once" && state.status === "loading")) void readAudit(api);
  }, []);
  return { state, reload: () => readAudit(api) };
}

/** A card muted or unmuted, its suggestion worked out again by the API's own rules. */
export function withMuted(c: AuditCard, muted: boolean): AuditCard {
  return { ...c, muted, ...suggest({ ...c, muted }) };
}

/** Mutes or unmutes a newsletter from its card, moving it at once. Throws the API's error. */
export async function setAuditMuted(api: LibraryApi, senderId: string, muted: boolean) {
  const before = state;
  if (before.status === "ok") {
    const cards = before.data.cards
      .map((c) => (c.senderId === senderId ? withMuted(c, muted) : c))
      .sort(byVerdict);
    put({ status: "ok", data: { ...before.data, cards } });
  }
  try {
    await api.updateSender(senderId, { muted });
  } catch (err) {
    put(before);
    throw err;
  }
  void readAudit(api);
}
