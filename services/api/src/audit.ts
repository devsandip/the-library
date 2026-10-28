/**
 * Subscription audit (#25, #150): a report card per newsletter over the last 30 days, worked out
 * when asked from what is stored (`@library/core`'s `audit`). Nothing is kept; no model is called.
 */
import { AUDIT_DAYS, AUDIT_LEAD_DAYS, audit, type AuditData } from "@library/core";
import type { AuditResponse } from "@library/core/types";
import type { AuditPort } from "./port.js";

const DAY_MS = 86_400_000;

/** Where the audit's numbers are read. DynamoRepo implements it; tests use a fake. */
export interface AuditStore {
  /** The first open logged, every sender, and the issues, stories and opens since each time. */
  readAudit(since: { issues: string; stories: string; opened: string }): Promise<AuditData>;
}

export class Audits implements AuditPort {
  constructor(
    private readonly store: AuditStore,
    private readonly now: () => number = Date.now,
  ) {}

  async audit(): Promise<AuditResponse> {
    const now = this.now();
    const start = now - AUDIT_DAYS * DAY_MS;
    const iso = (t: number) => new Date(t).toISOString();
    // Issues from the lead too, so a story there is known by its issue's newsletter.
    const lead = iso(start - AUDIT_LEAD_DAYS * DAY_MS);
    const data = await this.store.readAudit({ issues: lead, stories: lead, opened: iso(start) });
    return audit(now, data);
  }
}
