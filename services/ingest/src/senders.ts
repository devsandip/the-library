/**
 * Rebuild sender items from the issues they own (`pnpm rebuild-senders`). Run after changing the
 * sender rules in packages/core/src/sources.ts: issues whose sender or publication changed are
 * re-keyed, and every sender item is recomputed from its issues, so counts, ratings, addresses
 * and names match what is stored. Flags (muted) are kept; a sender created by a split inherits
 * them from the sender its issues came from.
 */
import { senderIdentity } from "@library/core";
import type { Rating } from "@library/core/types";
import type { Store } from "./store.js";

export interface StoredIssue {
  id: string;
  senderId: string;
  publication: string;
  fromAddr: string;
  /** Absent on issues stored before From names were kept; the publication stands in for it. */
  fromName?: string;
  receivedAt: string;
  rating?: Rating;
  unsubscribeUrl?: string;
}

export interface StoredSender {
  senderId: string;
  senderKey?: string;
  publication?: string;
  muted?: boolean;
  onKeepList?: boolean;
  up?: number;
  down?: number;
  issueCount?: number;
  addresses?: string[];
  lastSeenAt?: string;
  unsubscribeUrl?: string;
}

/** What a sender item should hold, computed from its issues. */
export interface SenderFields {
  senderId: string;
  senderKey: string;
  publication: string;
  onKeepList: boolean;
  issueCount: number;
  up: number;
  down: number;
  addresses: string[];
  lastSeenAt: string;
  unsubscribeUrl?: string;
}

export interface IssueRekey {
  id: string;
  fromSenderId: string;
  toSenderId: string;
  publication: string;
}

export interface SenderPlan {
  rekeys: IssueRekey[];
  /** New sender items, with flags inherited from the senders their issues came from. */
  creates: (SenderFields & { muted: boolean })[];
  /** Existing sender items whose computed fields changed; `current` is what was read. */
  updates: { next: SenderFields; current: StoredSender }[];
  /** Sender items that no issue points at any more. */
  deletes: StoredSender[];
  unchanged: number;
}

export function planSenders(issues: StoredIssue[], senders: StoredSender[]): SenderPlan {
  const byId = new Map(senders.map((s) => [s.senderId, s]));
  const groups = new Map<
    string,
    { issue: StoredIssue; key: string; publication: string; keep: boolean }[]
  >();
  const rekeys: IssueRekey[] = [];

  for (const issue of issues) {
    const id = senderIdentity(issue.fromAddr, issue.fromName ?? issue.publication);
    if (id.senderId !== issue.senderId || id.publication !== issue.publication) {
      rekeys.push({
        id: issue.id,
        fromSenderId: issue.senderId,
        toSenderId: id.senderId,
        publication: id.publication,
      });
    }
    const group = groups.get(id.senderId) ?? [];
    group.push({ issue, key: id.senderKey, publication: id.publication, keep: id.onKeepList });
    groups.set(id.senderId, group);
  }

  const plan: SenderPlan = { rekeys, creates: [], updates: [], deletes: [], unchanged: 0 };
  for (const [senderId, group] of groups) {
    group.sort((a, b) => b.issue.receivedAt.localeCompare(a.issue.receivedAt));
    const latest = group[0]!;
    const next: SenderFields = {
      senderId,
      senderKey: latest.key,
      publication: latest.publication,
      onKeepList: latest.keep,
      issueCount: group.length,
      up: group.filter((g) => g.issue.rating === 1).length,
      down: group.filter((g) => g.issue.rating === -1).length,
      addresses: [...new Set(group.map((g) => g.issue.fromAddr))].sort(),
      lastSeenAt: latest.issue.receivedAt,
      unsubscribeUrl: group.find((g) => g.issue.unsubscribeUrl)?.issue.unsubscribeUrl,
    };
    const current = byId.get(senderId);
    if (!current) {
      const muted = group.some((g) => byId.get(g.issue.senderId)?.muted === true);
      plan.creates.push({ ...next, muted });
    } else if (changedFields(next, current).length) {
      plan.updates.push({ next, current });
    } else {
      plan.unchanged++;
    }
  }
  plan.deletes = senders.filter((s) => !groups.has(s.senderId));
  return plan;
}

/** Fields of `next` that differ from the stored sender item. */
export function changedFields(next: SenderFields, cur: StoredSender): string[] {
  const pairs: [string, unknown, unknown][] = [
    ["senderKey", next.senderKey, cur.senderKey],
    ["publication", next.publication, cur.publication],
    ["onKeepList", next.onKeepList, Boolean(cur.onKeepList)],
    ["issueCount", next.issueCount, cur.issueCount ?? 0],
    ["up", next.up, cur.up ?? 0],
    ["down", next.down, cur.down ?? 0],
    ["lastSeenAt", next.lastSeenAt, cur.lastSeenAt],
    ["unsubscribeUrl", next.unsubscribeUrl, cur.unsubscribeUrl],
    ["addresses", next.addresses.join(" "), [...(cur.addresses ?? [])].sort().join(" ")],
  ];
  return pairs.filter(([, a, b]) => a !== b).map(([name]) => name);
}

export interface RebuildReport {
  applied: boolean;
  issues: number;
  sendersBefore: number;
  sendersAfter: number;
  issuesRekeyed: number;
  created: string[];
  renamed: string[];
  /** Senders whose counts or other fields changed, with the field names. */
  recounted: string[];
  deleted: string[];
  errors: number;
  errorSamples: string[];
}

export function describePlan(
  plan: SenderPlan,
  issues: number,
  sendersBefore: number,
): RebuildReport {
  const renamed = plan.updates.filter((u) => u.next.publication !== u.current.publication);
  return {
    applied: false,
    issues,
    sendersBefore,
    sendersAfter: sendersBefore + plan.creates.length - plan.deletes.length,
    issuesRekeyed: plan.rekeys.length,
    created: plan.creates.map((c) => `${c.publication} (${c.issueCount})`),
    renamed: renamed.map((u) => `${u.current.publication} -> ${u.next.publication}`),
    recounted: plan.updates
      .filter((u) => u.next.publication === u.current.publication)
      .map((u) => `${u.next.publication}: ${changedFields(u.next, u.current).join(", ")}`),
    deleted: plan.deletes.map((d) => d.publication ?? d.senderId),
    errors: 0,
    errorSamples: [],
  };
}

/** Dry run unless `apply`. Runs in the ingest Lambda, so it never overlaps an ingest run. */
export async function rebuildSenders(
  store: Store,
  opts: { apply: boolean },
): Promise<RebuildReport> {
  const { issues, senders } = await store.scanForSenderRebuild();
  const plan = planSenders(issues, senders);
  const report = describePlan(plan, issues.length, senders.length);
  if (!opts.apply) return report;
  const errors = await store.applySenderPlan(plan);
  return { ...report, applied: true, errors: errors.length, errorSamples: errors.slice(0, 5) };
}
