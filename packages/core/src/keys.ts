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
/** The tune-up's proposals put off with Not now (#158): `dismissed`, id to Sandip's moves then. */
export const TUNEUP_KEY = { pk: "STATE", sk: "TUNEUP" } as const;
/** The topic list Claude proposed (`pnpm topics`). */
export const TOPICS_KEY = { pk: "CONFIG", sk: "TOPICS" } as const;
/** The five interests, embedded once by enrichment; they seed the ranking's taste profile. */
export const INTERESTS_KEY = { pk: "CONFIG", sk: "INTERESTS" } as const;
/**
 * The owner (#180): the reader whose Gmail the poller reads and whom the scheduled jobs serve. A
 * setting of the deployment that names a reader, not one of the reader's own items.
 */
export const OWNER_KEY = { pk: "CONFIG", sk: "OWNER" } as const;
/** A reader's settings (#184): time zone, interests, the line prompts use. */
export const settingsKey = (readerId: string) => ({ pk: `READER#${readerId}`, sk: "SETTINGS" });
/**
 * Every reader with settings, listed for the scheduled work (#210): `READERS` in `gsi1`, by
 * reader id. The deployment's own list, never under a reader's prefix.
 */
export const READERS_PARTITION = "READERS";
export const readerIndexAttributes = (readerId: string) => ({
  gsi1pk: READERS_PARTITION,
  gsi1sk: readerId,
});
/** A reader's own interests with their embeddings (#187), once they set interests. */
export const interestsKey = (readerId: string) => ({ pk: `READER#${readerId}`, sk: "INTERESTS" });
/** A day's model use (#208): one partition, a day per item, read back by day. */
export const USAGE_PK = "USAGE";
export const usageKey = (day: string) => ({ pk: USAGE_PK, sk: day });
/** The Summary's top 5 as first shown on a day (#5): `ids`, `at`. */
export const digestKey = (day: string) => ({ pk: `DIGEST#${day}`, sk: "META" });
/** Titan embedding of an issue, kept out of the META item so it never lands in an index. */
export const embeddingKey = (id: string) => ({ pk: `ISSUE#${id}`, sk: "EMB" });
/** One story of an issue (#15): headline, summary, names, link, embedding and event id. */
export const storyKey = (id: string, n: number) => ({
  pk: `ISSUE#${id}`,
  sk: `STORY#${String(n).padStart(2, "0")}`,
});
/** How an event's story evolved (#19), kept for the event so its other stories open it free. */
export const timelineKey = (eventId: string) => ({ pk: `TIMELINE#${eventId}`, sk: "META" });
/** A story checked against its source (#23), kept per story: the link is the story's own. */
export const sourceKey = (id: string, n: number) => ({
  pk: `SOURCE#${id}#${String(n).padStart(2, "0")}`,
  sk: "META",
});
/** The latest run of a story's source check, beside the check: running, or why it kept none. */
export const sourceRunKey = (id: string, n: number) => ({ pk: sourceKey(id, n).pk, sk: "RUN" });
/** How each newsletter covered an event (#17), kept for the event like its timeline. */
export const takesKey = (eventId: string) => ({ pk: `TAKES#${eventId}`, sk: "META" });
/** A followed story (#22), by its event; all of them are one partition, read in one query. */
export const FOLLOWING_PK = "FOLLOWING";
export const followKey = (eventId: string) => ({ pk: FOLLOWING_PK, sk: eventId });
/** Predictions (#24), all in one partition, read in one query: a few a day at most. */
export const PREDICTIONS_PK = "PREDICTIONS";
export const predictionKey = (issueId: string, k: number) => ({
  pk: PREDICTIONS_PK,
  sk: `${issueId}#${String(k).padStart(2, "0")}`,
});
/** A highlighted passage (#166), under its issue; in `gsi1` under `HIGHLIGHTS` by date too. */
export const highlightKey = (issueId: string, key: string) => ({
  pk: `ISSUE#${issueId}`,
  sk: `HL#${key}`,
});
/** A highlight's id, `<issueId>.<key>`. */
export const HIGHLIGHT_ID = /^([A-Za-z0-9_-]{1,64})\.([0-9a-z]{12})$/;
/** A highlight's key from its id; undefined for anything else. */
export function highlightKeyFromId(id: string) {
  const m = HIGHLIGHT_ID.exec(id);
  return m ? highlightKey(m[1]!, m[2]!) : undefined;
}
/** A highlight in `gsi1`, newest first for the Highlights page. */
export const highlightIndexAttributes = (issueId: string, key: string, at: string) => ({
  gsi1pk: PARTITION.highlights,
  gsi1sk: `${at}#${issueId}#${key}`,
});
/** A prediction's key from its id, `<issueId>.<k>`; undefined for anything else. */
export function predictionKeyFromId(id: string) {
  const m = /^([A-Za-z0-9_-]{1,64})\.([1-9][0-9]?)$/.exec(id);
  return m ? predictionKey(m[1]!, Number(m[2])) : undefined;
}

export const INDEX = {
  /** INBOX (unread + read) | ARCHIVE | SENDERS | STORIES | OPENS | HIGHLIGHTS */
  list: "gsi1",
  /**
   * Sparse: unread issues (UNREAD), saved ones (SAVED, #43), which leave UNREAD, and unread
   * Learning stories (LEARNING, #81).
   */
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
  highlights: "HIGHLIGHTS",
  unread: "UNREAD",
  saved: "SAVED",
  learning: "LEARNING",
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
 * Every index attribute an issue should carry, computed from its target state, rating and whether
 * it is saved. Attributes listed in `remove` must be removed in the same write, so an issue can
 * never sit in an index that no longer matches its state.
 */
export function issueIndexAttributes(issue: {
  id: string;
  senderId: string;
  receivedAt: string;
  state: IssueState;
  rating?: Rating;
  ratedAt?: string;
  /** Saved for later (#43). */
  savedAt?: string;
}): { set: Partial<Record<IssueIndexAttr, string>>; remove: IssueIndexAttr[] } {
  const sk = `${issue.receivedAt}#${issue.id}`;
  const set: Partial<Record<IssueIndexAttr, string>> = {};
  if (issue.state !== "filtered") {
    set.gsi1pk = issue.state === "archived" ? PARTITION.archive : PARTITION.inbox;
    set.gsi1sk = sk;
    set.gsi3pk = `SENDER#${issue.senderId}`;
    set.gsi3sk = sk;
    if (issue.savedAt) {
      // Saved is its own queue, newest saved first, and out of Unread whatever the state.
      set.gsi2pk = PARTITION.saved;
      set.gsi2sk = `${issue.savedAt}#${issue.id}`;
    } else if (issue.state === "unread") {
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

// ---------- Keys bound to a reader (milestone 13 of docs/features/multi-reader.md) ----------

/** What a reader's partition keys and index partitions start with; nothing for today's keys. */
export const readerPrefix = (readerId?: string) => (readerId ? `R#${readerId}#` : "");

/** Index partition attributes, the ones a reader's prefix goes on. */
const INDEX_PK = /^gsi[1-4]pk$/;

/**
 * Every key, partition and index value bound to a reader: the reader's prefix in front of each
 * partition key and index partition, sort keys and ids unchanged. Without a reader, today's
 * keys. `CONFIG/OWNER` and `READER#<id>` items are not a reader's and stay as they are.
 */
export function keysFor(readerId?: string) {
  const p = readerPrefix(readerId);
  const key = <K extends { pk: string; sk: string }>(k: K): K => ({ ...k, pk: `${p}${k.pk}` });
  const indexed = <T extends Record<string, unknown>>(attrs: T): T =>
    Object.fromEntries(
      Object.entries(attrs).map(([k, v]) => [
        k,
        INDEX_PK.test(k) && typeof v === "string" ? p + v : v,
      ]),
    ) as T;
  const issuePk = `${p}ISSUE#`;
  return {
    prefix: p,
    issue: (id: string) => key(issueKey(id)),
    senderItem: (senderId: string) => key(senderItemKey(senderId)),
    event: (id: string, at: string, rand: string) => key(eventKey(id, at, rand)),
    ingestState: key(INGEST_STATE_KEY),
    narrative: key(NARRATIVE_KEY),
    nowReading: key(NOW_READING_KEY),
    tuneup: key(TUNEUP_KEY),
    topics: key(TOPICS_KEY),
    interests: key(INTERESTS_KEY),
    digest: (day: string) => key(digestKey(day)),
    usagePk: `${p}${USAGE_PK}`,
    usage: (day: string) => key(usageKey(day)),
    embedding: (id: string) => key(embeddingKey(id)),
    story: (id: string, n: number) => key(storyKey(id, n)),
    timeline: (eventId: string) => key(timelineKey(eventId)),
    source: (id: string, n: number) => key(sourceKey(id, n)),
    sourceRun: (id: string, n: number) => key(sourceRunKey(id, n)),
    takes: (eventId: string) => key(takesKey(eventId)),
    followingPk: `${p}${FOLLOWING_PK}`,
    follow: (eventId: string) => key(followKey(eventId)),
    predictionsPk: `${p}${PREDICTIONS_PK}`,
    prediction: (issueId: string, k: number) => key(predictionKey(issueId, k)),
    predictionFromId: (id: string) => {
      const k = predictionKeyFromId(id);
      return k && key(k);
    },
    highlight: (issueId: string, k: string) => key(highlightKey(issueId, k)),
    highlightFromId: (id: string) => {
      const k = highlightKeyFromId(id);
      return k && key(k);
    },
    highlightIndex: (issueId: string, k: string, at: string) =>
      indexed(highlightIndexAttributes(issueId, k, at)),
    partition: Object.fromEntries(
      Object.entries(PARTITION).map(([name, v]) => [name, `${p}${v}`]),
    ) as { [K in keyof typeof PARTITION]: string },
    /** A sender's partition in `gsi3`. */
    senderPartition: (senderId: string) => `${p}SENDER#${senderId}`,
    issueIndex: (issue: Parameters<typeof issueIndexAttributes>[0]) => {
      const { set, remove } = issueIndexAttributes(issue);
      return { set: indexed(set), remove };
    },
    openIndex: (id: string, at: string) => indexed(openIndexAttributes(id, at)),
    senderIndex: (senderId: string, publication: string) =>
      indexed(senderIndexAttributes(senderId, publication)),
    /** Any index attributes, with the reader's prefix on their partitions. */
    indexed,
    /** An issue's id from one of its items' pk; undefined for anything else. */
    issueIdOf: (pk: string) => (pk.startsWith(issuePk) ? pk.slice(issuePk.length) : undefined),
    /** A sender's id from its item's pk; undefined for anything else. */
    senderIdOf: (pk: string) =>
      pk.startsWith(`${p}SENDER#`) ? pk.slice(`${p}SENDER#`.length) : undefined,
    /** Whether a partition key is this reader's (every key is, without a reader). */
    owns: (pk: string) => pk.startsWith(p),
  };
}

export type Keys = ReturnType<typeof keysFor>;
