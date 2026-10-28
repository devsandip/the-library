/**
 * Subscription audit (#25, #150): a report card per newsletter over the last 30 days, from the
 * archive alone (issues, opens, ratings and the story index's events), and a suggestion worked out
 * here with the numbers behind it. Pure, so the API and the tests share one set of rules. Nothing
 * is stored and no model is called; unsubscribing is Sandip's tap on the newsletter's own link.
 */
import type {
  AuditCard,
  AuditHeadline,
  AuditReason,
  AuditResponse,
  AuditVerdict,
  Rating,
  SenderListItem,
} from "./types.js";

/** The audit looks back this many days. */
export const AUDIT_DAYS = 30;
/** Fewer issues than this in the window is too few to judge. */
export const AUDIT_MIN_ISSUES = 4;
/** Opened less than this share of its issues, and never rated useful: worth dropping. */
export const AUDIT_OPEN_SHARE = 0.1;
/** At least this many linked stories, this share of them carried first elsewhere: mostly repeats. */
export const AUDIT_MIN_STORIES = 8;
export const AUDIT_REPEAT_SHARE = 0.6;
/** Rated not useful at least this often, and more often than useful: worth dropping. */
export const AUDIT_MIN_NOT_USEFUL = 2;
/**
 * Stories are read from this many days before the window, so a story early in it can find the
 * newsletter that carried its event first (linking joins within 3 days, and an event can chain).
 */
export const AUDIT_LEAD_DAYS = 7;
/** Headlines of stories only it carried, latest first. */
const ONLY_HEADLINES = 3;

const DAY_MS = 86_400_000;

/** An issue as the audit reads it. */
export interface AuditIssue {
  id: string;
  senderId: string;
  receivedAt: string;
  rating?: Rating;
  promo?: boolean;
}

/** A story as the audit reads it: its event links it to other newsletters' stories (#15). */
export interface AuditStory {
  /** Its issue's id. */
  id: string;
  n: number;
  /** As written at the split; its issue's sender wins when the issue is known (senders re-key). */
  senderId: string;
  receivedAt: string;
  headline: string;
  eventId?: string;
}

/** What the audit is worked out from. Reading more than the window is fine: it is applied here. */
export interface AuditData {
  /** The first open or peek ever logged: whether issues before it were read is unknown. */
  firstOpen?: string;
  senders: SenderListItem[];
  /** Issues received since the window's earliest start, and its lead for stories. */
  issues: AuditIssue[];
  /** Stories from `AUDIT_LEAD_DAYS` before the window's earliest start. */
  stories: AuditStory[];
  /** Ids of issues opened or peeked at in the window. */
  opened: Iterable<string>;
}

/** The window: the last 30 days, starting no earlier than the first open logged. */
export function auditWindow(now: number, firstOpen?: string): { from: string; to: string } {
  const start = now - AUDIT_DAYS * DAY_MS;
  const from = firstOpen && Date.parse(firstOpen) > start ? Date.parse(firstOpen) : start;
  return { from: new Date(Math.min(from, now)).toISOString(), to: new Date(now).toISOString() };
}

/** The numbers a suggestion rests on. */
export type AuditNumbers = Pick<
  AuditCard,
  "muted" | "mustRead" | "issues" | "opened" | "useful" | "notUseful" | "stories" | "repeats"
>;

/**
 * Keep, drop or wait, and why: Must Read is always kept, muted is worth dropping, under 4 issues is
 * too new; then rated not useful, hardly opened, or mostly repeats; otherwise kept.
 */
export function suggest(c: AuditNumbers): { verdict: AuditVerdict; reason: AuditReason } {
  if (c.mustRead) return { verdict: "keep", reason: "mustRead" };
  if (c.muted) return { verdict: "drop", reason: "muted" };
  if (c.issues < AUDIT_MIN_ISSUES) return { verdict: "new", reason: "few" };
  if (c.notUseful >= AUDIT_MIN_NOT_USEFUL && c.notUseful > c.useful) {
    return { verdict: "drop", reason: "notUseful" };
  }
  if (c.useful === 0 && c.opened < AUDIT_OPEN_SHARE * c.issues) {
    return { verdict: "drop", reason: "unopened" };
  }
  if (
    c.useful === 0 &&
    c.stories >= AUDIT_MIN_STORIES &&
    c.repeats >= AUDIT_REPEAT_SHARE * c.stories
  ) {
    return { verdict: "drop", reason: "repeats" };
  }
  return { verdict: "keep", reason: c.useful > 0 ? "useful" : "opened" };
}

const ORDER: Record<AuditVerdict, number> = { drop: 0, keep: 1, new: 2 };

/** Worth dropping first, then kept, then too new; each with the most issues first. */
export const byVerdict = (a: AuditCard, b: AuditCard) =>
  ORDER[a.verdict] - ORDER[b.verdict] ||
  b.issues - a.issues ||
  a.publication.localeCompare(b.publication);

/** A card per newsletter with issues in the window: worth dropping first, most issues first. */
export function audit(now: number, data: AuditData): AuditResponse {
  const { from, to } = auditWindow(now, data.firstOpen);
  const senders = new Map(data.senders.map((s) => [s.senderId, s]));
  const opened = new Set(data.opened);
  const senderOf = new Map(data.issues.map((i) => [i.id, i.senderId]));
  const muted = (id: string) => senders.get(id)?.muted === true;

  const cards = new Map<string, AuditCard>();
  const counted = new Set<string>();
  for (const i of data.issues) {
    if (i.receivedAt < from || i.receivedAt > to) continue;
    const s = senders.get(i.senderId);
    if (!s) continue;
    counted.add(i.id);
    const c = cards.get(i.senderId) ?? emptyCard(s);
    c.issues++;
    if (i.promo) c.promos++;
    if (opened.has(i.id)) c.opened++;
    if (i.rating === 1) c.useful++;
    if (i.rating === -1) c.notUseful++;
    cards.set(i.senderId, c);
  }

  // Each event's stories, oldest first, with the sender their issue has now.
  const stories = data.stories
    .filter((s) => s.eventId)
    .map((s) => ({ ...s, senderId: senderOf.get(s.id) ?? s.senderId }))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.n - b.n);
  const events = new Map<string, typeof stories>();
  for (const s of stories) {
    const list = events.get(s.eventId!);
    if (list) list.push(s);
    else events.set(s.eventId!, [s]);
  }

  const firstBy = new Map<string, Map<string, number>>();
  const onlyLatest = new Map<string, AuditHeadline[]>();
  for (const s of stories) {
    const c = cards.get(s.senderId);
    if (!c || !counted.has(s.id)) continue;
    c.stories++;
    // Another newsletter's story about the same event, from one Sandip still sees.
    const others = events
      .get(s.eventId!)!
      .filter((o) => o.senderId !== s.senderId && !muted(o.senderId));
    const first = others.find((o) => o.receivedAt < s.receivedAt);
    if (first) {
      c.repeats++;
      const by = firstBy.get(s.senderId) ?? new Map<string, number>();
      by.set(first.senderId, (by.get(first.senderId) ?? 0) + 1);
      firstBy.set(s.senderId, by);
    } else if (!others.length) {
      c.only++;
      onlyLatest.set(s.senderId, [
        { issueId: s.id, n: s.n, headline: s.headline },
        ...(onlyLatest.get(s.senderId) ?? []),
      ]);
    }
  }

  for (const c of cards.values()) {
    const top = [...(firstBy.get(c.senderId) ?? [])].sort(
      ([a, x], [b, y]) => y - x || name(senders, a).localeCompare(name(senders, b)),
    )[0];
    if (top) c.firstBy = { senderId: top[0], publication: name(senders, top[0]), stories: top[1] };
    c.onlyHeadlines = (onlyLatest.get(c.senderId) ?? []).slice(0, ONLY_HEADLINES);
    Object.assign(c, suggest(c));
  }
  return {
    from,
    to,
    days: Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)),
    cards: [...cards.values()].sort(byVerdict),
  };
}

const name = (senders: Map<string, SenderListItem>, id: string) =>
  senders.get(id)?.publication ?? id;

function emptyCard(s: SenderListItem): AuditCard {
  return {
    senderId: s.senderId,
    publication: s.publication,
    muted: s.muted,
    mustRead: s.mustRead,
    ...(s.unsubscribeUrl ? { unsubscribeUrl: s.unsubscribeUrl } : {}),
    issues: 0,
    promos: 0,
    opened: 0,
    useful: 0,
    notUseful: 0,
    stories: 0,
    repeats: 0,
    only: 0,
    onlyHeadlines: [],
    verdict: "new",
    reason: "few",
  };
}
