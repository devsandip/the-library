/** DynamoDB key layout. See docs/architecture.md section 5. */
import type { IssueState, Rating } from "./types.js";

export const issueKey = (id: string) => ({ pk: `ISSUE#${id}`, sk: "META" });
export const senderItemKey = (senderId: string) => ({ pk: `SENDER#${senderId}`, sk: "META" });
export const eventKey = (id: string, at: string, rand: string) => ({
  pk: `ISSUE#${id}`,
  sk: `EVT#${at}#${rand}`,
});
export const INGEST_STATE_KEY = { pk: "STATE", sk: "INGEST" } as const;
/** The latest narrative of the day's news (#18), with the story keys it was written from. */
export const NARRATIVE_KEY = { pk: "STATE", sk: "NARRATIVE" } as const;
/** The issue Now reading points at (#44), and the place in it. One item, overwritten. */
export const NOW_READING_KEY = { pk: "STATE", sk: "NOW_READING" } as const;
/** The topic list Claude proposed (`pnpm topics`). */
export const TOPICS_KEY = { pk: "CONFIG", sk: "TOPICS" } as const;
/** The five interests, embedded once by enrichment; they seed the ranking's taste profile. */
export const INTERESTS_KEY = { pk: "CONFIG", sk: "INTERESTS" } as const;
/** The Summary's top 5 as first shown on a day (#5): `ids`, `at`. */
export const digestKey = (day: string) => ({ pk: `DIGEST#${day}`, sk: "META" });
/** Titan embedding of an issue, kept out of the META item so it never lands in an index. */
export const embeddingKey = (id: string) => ({ pk: `ISSUE#${id}`, sk: "EMB" });
/** One story of an issue (#15): headline, summary, names, link, embedding and event id. */
export const storyKey = (id: string, n: number) => ({
  pk: `ISSUE#${id}`,
  sk: `STORY#${String(n).padStart(2, "0")}`,
});

export const INDEX = {
  /** INBOX (unread + read) | ARCHIVE | SENDERS | STORIES | OPENS */
  list: "gsi1",
  /** Sparse: unread issues only. */
  unread: "gsi2",
  /** SENDER#<senderId> */
  bySender: "gsi3",
  /** Sparse: rated issues only (Phase 2 taste profile). */
  rated: "gsi4",
} as const;

export const PARTITION = {
  inbox: "INBOX",
  archive: "ARCHIVE",
  senders: "SENDERS",
  stories: "STORIES",
  opens: "OPENS",
  unread: "UNREAD",
  rated: "RATED",
} as const;

const ISSUE_INDEX_ATTRS = [
  "gsi1pk",
  "gsi1sk",
  "gsi2pk",
  "gsi2sk",
  "gsi3pk",
  "gsi3sk",
  "gsi4pk",
  "gsi4sk",
] as const;
export type IssueIndexAttr = (typeof ISSUE_INDEX_ATTRS)[number];

/**
 * Every index attribute an issue should carry, computed from its target state and rating.
 * Attributes listed in `remove` must be removed in the same write, so an issue can never sit in
 * an index that no longer matches its state.
 */
export function issueIndexAttributes(issue: {
  id: string;
  senderId: string;
  receivedAt: string;
  state: IssueState;
  rating?: Rating;
  ratedAt?: string;
}): { set: Partial<Record<IssueIndexAttr, string>>; remove: IssueIndexAttr[] } {
  const sk = `${issue.receivedAt}#${issue.id}`;
  const set: Partial<Record<IssueIndexAttr, string>> = {};
  if (issue.state !== "filtered") {
    set.gsi1pk = issue.state === "archived" ? PARTITION.archive : PARTITION.inbox;
    set.gsi1sk = sk;
    set.gsi3pk = `SENDER#${issue.senderId}`;
    set.gsi3sk = sk;
    if (issue.state === "unread") {
      set.gsi2pk = PARTITION.unread;
      set.gsi2sk = sk;
    }
    if (issue.rating && issue.ratedAt) {
      set.gsi4pk = PARTITION.rated;
      set.gsi4sk = `${issue.ratedAt}#${issue.id}`;
    }
  }
  return { set, remove: ISSUE_INDEX_ATTRS.filter((a) => !(a in set)) };
}

/** An `open` event in `gsi1`, by time, so read history (#42) reads a day in one query. */
export const openIndexAttributes = (id: string, at: string) => ({
  gsi1pk: PARTITION.opens,
  gsi1sk: `${at}#${id}`,
});

export const senderIndexAttributes = (senderId: string, publication: string) => ({
  gsi1pk: PARTITION.senders,
  gsi1sk: `${publication.toLowerCase()}#${senderId}`,
});

export const s3Keys = (id: string) => ({
  raw: `raw/${id}.eml`,
  html: `html/${id}.html`,
  text: `text/${id}.txt`,
});
