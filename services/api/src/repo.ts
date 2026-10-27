import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type BatchGetCommandOutput,
  type QueryCommandInput,
  type QueryCommandOutput,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  CANDIDATE_DAYS,
  DIGEST_DAYS,
  DIGEST_SIZE,
  digestKey,
  embeddingKey,
  eventKey,
  INDEX,
  INGEST_STATE_KEY,
  INTERESTS_KEY,
  NARRATIVE_KEY,
  NOW_READING_KEY,
  openIndexAttributes,
  issueIndexAttributes,
  issueKey,
  issueShelf,
  PARTITION,
  pickTop,
  rank,
  readerDay,
  readerDayBounds,
  recentDays,
  relatedIssues,
  retryOnConflict,
  s3Keys,
  senderItemKey,
  storyIndexAttributes,
  storyKey,
  storyRef,
  storyShelf,
  timelineKey,
  TOPICS_KEY,
  toVector,
  EMBED_DIMENSIONS,
  type InterestVector,
  type RelatedMatch,
} from "@library/core";
import type {
  DigestStats,
  HistoryItem,
  HistoryResponse,
  IssueDetailResponse,
  IssueListItem,
  IssueListResponse,
  IssueState,
  IssueStoriesResponse,
  IssueStory,
  Narrative,
  NowReadingResponse,
  Rating,
  ReaderState,
  RelatedItem,
  RelatedResponse,
  SenderDetailResponse,
  SenderListItem,
  SenderPatch,
  Shelf,
  ShelfSetBy,
  StatusResponse,
  StoryShelfSetBy,
  StoryState,
  SummaryResponse,
  Timeline,
  Topic,
  UnreadCount,
  UnreadCountsResponse,
  View,
} from "@library/core/types";
import { badRequest, conflict, notFound } from "./errors.js";
import type { ListOptions, RepoPort } from "./port.js";
import type { CorpusIssue, CorpusSource, CorpusStory } from "./corpus.js";
import type { OwnStory, RelatedSource } from "./related.js";
import type { SearchSource } from "./search.js";
import type { StoredTimeline, TimelineStore, TimelineStory } from "./timeline.js";

type Item = Record<string, unknown>;

/** The attributes `toListItem` reads, for batch reads. */
const LIST_ATTRIBUTES = [
  "id",
  "senderId",
  "publication",
  "subject",
  "snippet",
  "receivedAt",
  "readMinutes",
  "state",
  "rating",
  "viewOnlineUrl",
  "summary",
  "shelf",
  "topic",
  "promo",
  "autoArchived",
  "savedAt",
];

export function toListItem(i: Item): IssueListItem {
  return {
    id: i.id as string,
    senderId: i.senderId as string,
    publication: i.publication as string,
    subject: i.subject as string,
    snippet: (i.snippet as string | undefined) ?? "",
    receivedAt: i.receivedAt as string,
    readMinutes: (i.readMinutes as number | undefined) ?? 1,
    state: i.state as ReaderState,
    rating: i.rating as Rating | undefined,
    viewOnlineUrl: i.viewOnlineUrl as string | undefined,
    summary: i.summary as string | undefined,
    shelf: i.shelf as Shelf | undefined,
    topic: i.topic as string | undefined,
    promo: i.promo as boolean | undefined,
    autoArchived: i.autoArchived as IssueListItem["autoArchived"],
    savedAt: i.savedAt as string | undefined,
    scoreReason: i.scoreReason as string | undefined,
  };
}

export function toSender(s: Item): SenderListItem {
  return {
    senderId: s.senderId as string,
    senderKey: s.senderKey as string,
    publication: s.publication as string,
    muted: Boolean(s.muted),
    mustRead: Boolean(s.mustRead),
    shelf: s.shelf as Shelf | undefined,
    up: (s.up as number | undefined) ?? 0,
    down: (s.down as number | undefined) ?? 0,
    issueCount: (s.issueCount as number | undefined) ?? 0,
    lastSeenAt: s.lastSeenAt as string,
    unsubscribeUrl: s.unsubscribeUrl as string | undefined,
  };
}

function isConditionFailure(err: unknown): boolean {
  const e = err as { name?: string; CancellationReasons?: { Code?: string }[] };
  return (
    e.name === "ConditionalCheckFailedException" ||
    (e.name === "TransactionCanceledException" &&
      (e.CancellationReasons ?? []).some((r) => r.Code === "ConditionalCheckFailed"))
  );
}

/** SET/REMOVE expression with every attribute name aliased (state, rating... are reserved). */
function updateExpression(set: Record<string, unknown>, remove: string[]) {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets = Object.entries(set).map(([k, v], i) => {
    names[`#s${i}`] = k;
    values[`:s${i}`] = v;
    return `#s${i} = :s${i}`;
  });
  const removes = remove.map((k, i) => {
    names[`#r${i}`] = k;
    return `#r${i}`;
  });
  const expr = [
    sets.length ? `SET ${sets.join(", ")}` : "",
    removes.length ? `REMOVE ${removes.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { expr, names, values };
}

type Filter = { expr: string; names: Record<string, string>; values: Record<string, unknown> };

interface IndexQuery {
  index: string;
  pkAttr: string;
  skAttr: string;
  pkValue: string;
  filter?: Filter;
}

/** AND filters together; each one uses its own placeholder prefix. */
function andFilters(...filters: (Filter | undefined)[]): Filter | undefined {
  const fs = filters.filter((f): f is Filter => f !== undefined);
  if (fs.length <= 1) return fs[0];
  return {
    expr: fs.map((f) => `(${f.expr})`).join(" AND "),
    names: Object.assign({}, ...fs.map((f) => f.names)) as Record<string, string>,
    values: Object.assign({}, ...fs.map((f) => f.values)) as Record<string, unknown>,
  };
}

/** News also holds issues Claude has not sorted yet. */
function shelfFilter(shelf: Shelf): Filter {
  return shelf === "news"
    ? {
        expr: "attribute_not_exists(#sh) OR #sh = :sh",
        names: { "#sh": "shelf" },
        values: { ":sh": "news" },
      }
    : { expr: "#sh = :sh", names: { "#sh": "shelf" }, values: { ":sh": "learning" } };
}

/** The states each view shows when it reads a sender's index. Saved has its own partition. */
const VIEW_STATES: Record<Exclude<View, "saved">, IssueState[]> = {
  unread: ["unread"],
  all: ["unread", "read"],
  archived: ["archived"],
};

function inFilter(attr: string, prefix: string, values: string[], negate = false) {
  const names = { [`#${prefix}`]: attr };
  const vals = Object.fromEntries(values.map((v, i) => [`:${prefix}${i}`, v]));
  const list = Object.keys(vals).join(", ");
  const expr = negate ? `NOT (#${prefix} IN (${list}))` : `#${prefix} IN (${list})`;
  return { expr, names, values: vals };
}

/** Unread cursors: which stream (1 Must Read, 2 everything else), plus that stream's cursor. */
function encodePhase(phase: 1 | 2, cursor?: string): string {
  return Buffer.from(JSON.stringify(cursor ? { p: phase, c: cursor } : { p: phase })).toString(
    "base64url",
  );
}

function decodePhase(cursor: string | undefined): { phase: 1 | 2; cursor?: string } {
  if (cursor === undefined) return { phase: 1 };
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw badRequest("bad cursor");
  }
  const o = v as { p?: unknown; c?: unknown } | null;
  if (
    typeof o !== "object" ||
    o === null ||
    (o.p !== 1 && o.p !== 2) ||
    (o.c !== undefined && typeof o.c !== "string")
  ) {
    throw badRequest("bad cursor");
  }
  return { phase: o.p, cursor: o.c as string | undefined };
}

export class DynamoRepo
  implements RepoPort, CorpusSource, SearchSource, RelatedSource, TimelineStore
{
  private readonly ddb: DynamoDBDocumentClient;
  private readonly s3: S3Client;
  private readonly table: string;
  private readonly bucket: string;
  private readonly stage: string;
  /** Issue embeddings already read (they do not change); see `embeddings`. */
  private readonly vectorCache = new Map<string, Float32Array>();

  constructor(opts: {
    table: string;
    bucket: string;
    stage: string;
    ddb?: DynamoDBClient;
    s3?: S3Client;
  }) {
    this.table = opts.table;
    this.bucket = opts.bucket;
    this.stage = opts.stage;
    this.ddb = DynamoDBDocumentClient.from(opts.ddb ?? new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.s3 = opts.s3 ?? new S3Client({});
  }

  // ---------- issues ----------

  private unreadQuery(filter?: Filter): IndexQuery {
    return {
      index: INDEX.unread,
      pkAttr: "gsi2pk",
      skAttr: "gsi2sk",
      pkValue: PARTITION.unread,
      filter,
    };
  }

  /**
   * One view as one index stream. Muted senders are hidden everywhere but Archived and Saved,
   * unless they are picked: one sender reads its own index, several filter the view's index.
   */
  private viewQuery(view: View, muted: string[], senderIds?: string[], extra?: Filter): IndexQuery {
    if (view === "saved") {
      // Saved for later (#43): its own partition, newest saved first. Saving was a choice, so it
      // hides no one, like Archived.
      return {
        index: INDEX.unread,
        pkAttr: "gsi2pk",
        skAttr: "gsi2sk",
        pkValue: PARTITION.saved,
        filter: andFilters(
          senderIds?.length ? inFilter("senderId", "sid", senderIds) : undefined,
          extra,
        ),
      };
    }
    if (senderIds?.length === 1) {
      return {
        index: INDEX.bySender,
        pkAttr: "gsi3pk",
        skAttr: "gsi3sk",
        pkValue: `SENDER#${senderIds[0]}`,
        filter: andFilters(inFilter("state", "st", VIEW_STATES[view]), extra),
      };
    }
    const q: IndexQuery =
      view === "unread"
        ? this.unreadQuery()
        : {
            index: INDEX.list,
            pkAttr: "gsi1pk",
            skAttr: "gsi1sk",
            pkValue: view === "archived" ? PARTITION.archive : PARTITION.inbox,
          };
    // Archived is an explicit view: show everything archived. DynamoDB allows 100 values in IN;
    // muting more than 100 senders is not a real scenario.
    const who = senderIds?.length
      ? inFilter("senderId", "sid", senderIds)
      : view !== "archived" && muted.length
        ? inFilter("senderId", "m", muted.slice(0, 100), true)
        : undefined;
    return { ...q, filter: andFilters(who, extra) };
  }

  private decodeCursor(cursor: string | undefined, q: IndexQuery): Item | undefined {
    if (cursor === undefined) return undefined;
    let key: unknown;
    try {
      key = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
      throw badRequest("bad cursor");
    }
    const k = key as Record<string, unknown>;
    const attrs = ["pk", "sk", q.pkAttr, q.skAttr];
    const valid =
      typeof k === "object" &&
      k !== null &&
      Object.keys(k).length === 4 &&
      attrs.every((a) => typeof k[a] === "string") &&
      k[q.pkAttr] === q.pkValue;
    if (!valid) throw badRequest("bad cursor");
    return k;
  }

  private encodeCursor(item: Item, q: IndexQuery): string {
    const key = {
      pk: item.pk,
      sk: item.sk,
      [q.pkAttr]: item[q.pkAttr],
      [q.skAttr]: item[q.skAttr],
    };
    return Buffer.from(JSON.stringify(key)).toString("base64url");
  }

  /**
   * Issues for a view, newest first. In Unread without a sender filter, Must Read newsletters
   * come first. Several senders or topics mean any of them.
   */
  async listIssues(view: View, opts: ListOptions): Promise<IssueListResponse> {
    const senders = await this.listSenders();
    const muted = senders.filter((s) => s.muted).map((s) => s.senderId);
    const starred = new Set(senders.filter((s) => s.mustRead).map((s) => s.senderId));
    const extra = andFilters(
      opts.shelf ? shelfFilter(opts.shelf) : undefined,
      opts.topics?.length ? inFilter("topic", "tp", opts.topics) : undefined,
    );
    const picked = opts.senderIds?.length ? opts.senderIds : undefined;
    const page =
      view === "unread" && !picked
        ? await this.listUnread(
            [...starred].filter((id) => !muted.includes(id)),
            muted,
            opts,
            extra,
          )
        : await this.readStream(
            this.viewQuery(view, muted, picked, extra),
            opts.limit,
            opts.cursor,
          );
    return {
      ...page,
      items: page.items.map((i) => (starred.has(i.senderId) ? { ...i, mustRead: true } : i)),
    };
  }

  /**
   * Unread as two streams over the UNREAD index, one after the other: Must Read newsletters, then
   * everything else. The cursor names the stream it continues and wraps that stream's cursor.
   */
  private async listUnread(
    must: string[],
    muted: string[],
    opts: ListOptions,
    extra?: Filter,
  ): Promise<IssueListResponse> {
    const first = must.length
      ? this.unreadQuery(andFilters(inFilter("senderId", "mr", must), extra))
      : undefined;
    const hide = [...must, ...muted];
    const rest = this.unreadQuery(
      andFilters(hide.length ? inFilter("senderId", "x", hide, true) : undefined, extra),
    );
    const at = decodePhase(opts.cursor);

    if (at.phase === 1 && first) {
      const page = await this.readStream(first, opts.limit, at.cursor);
      if (page.cursor) return { items: page.items, cursor: encodePhase(1, page.cursor) };
      // Must Read is exhausted: fill the page from everything else (peek one if it is full).
      const room = opts.limit - page.items.length;
      const next = await this.readStream(rest, Math.max(room, 1), undefined);
      if (room === 0) {
        return { items: page.items, cursor: next.items.length ? encodePhase(2) : undefined };
      }
      return {
        items: [...page.items, ...next.items],
        cursor: next.cursor ? encodePhase(2, next.cursor) : undefined,
      };
    }
    const page = await this.readStream(rest, opts.limit, at.phase === 2 ? at.cursor : undefined);
    return { items: page.items, cursor: page.cursor ? encodePhase(2, page.cursor) : undefined };
  }

  /**
   * One index stream, newest first. Filters (muted senders, states) apply after DynamoDB's Limit,
   * so keep reading until the page is full. The next cursor is the last returned item's key, so
   * trimming never skips anything.
   */
  private async readStream(
    q: IndexQuery,
    limit: number,
    cursor: string | undefined,
  ): Promise<IssueListResponse> {
    let start = this.decodeCursor(cursor, q);
    const items: Item[] = [];
    let exhausted = false;

    for (let round = 0; round < 10 && items.length <= limit; round++) {
      const need = limit + 1 - items.length;
      const res: QueryCommandOutput = await this.query({
        IndexName: q.index,
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": q.pkAttr, ...q.filter?.names },
        ExpressionAttributeValues: { ":pk": q.pkValue, ...q.filter?.values },
        FilterExpression: q.filter?.expr,
        ScanIndexForward: false,
        Limit: q.filter ? Math.max(need, 50) : need,
        ExclusiveStartKey: start,
      });
      items.push(...(res.Items ?? []));
      if (!res.LastEvaluatedKey) {
        exhausted = true;
        break;
      }
      start = res.LastEvaluatedKey;
    }

    if (items.length > limit) {
      const page = items.slice(0, limit);
      return { items: page.map(toListItem), cursor: this.encodeCursor(page[page.length - 1]!, q) };
    }
    // Short page: either the index is exhausted, or the round cap hit; then resume where reading stopped.
    const next =
      exhausted || !start ? undefined : Buffer.from(JSON.stringify(start)).toString("base64url");
    return { items: items.map(toListItem), cursor: next };
  }

  private async mustGetIssue(id: string): Promise<Item> {
    const res = await this.ddb.send(new GetCommand({ TableName: this.table, Key: issueKey(id) }));
    if (!res.Item || res.Item.state === "filtered") throw notFound("issue not found");
    return res.Item;
  }

  private async readObject(key: string): Promise<string | undefined> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return await res.Body?.transformToString("utf-8");
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return undefined;
      throw err;
    }
  }

  async getIssue(id: string): Promise<IssueDetailResponse> {
    const [item, place] = await Promise.all([this.mustGetIssue(id), this.nowReadingItem()]);
    const keys = s3Keys(id);
    // Sanitized HTML expires after a year; the clean text is kept forever.
    let html = await this.readObject(keys.html);
    if (html === undefined) {
      const text =
        (await this.readObject(keys.text)) ?? "This issue's content is no longer stored.";
      const escaped = text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      html = `<pre style="white-space:pre-wrap;font-family:inherit">${escaped}</pre>`;
    }
    const position = place?.issueId === id ? (place.position as number) : 0;
    return {
      ...toListItem(item),
      fromAddr: item.fromAddr as string,
      unsubscribeUrl: item.unsubscribeUrl as string | undefined,
      html,
      // The reader goes back to the place in the issue Now reading points at (#44).
      ...(position > 0 && position < 1 ? { position } : {}),
    };
  }

  private async transact(items: NonNullable<TransactWriteCommandInput["TransactItems"]>) {
    try {
      // An ingest run may be bumping the same sender's counters right now: retry that clash.
      await retryOnConflict(() =>
        this.ddb.send(new TransactWriteCommand({ TransactItems: items })),
      );
    } catch (err) {
      if (isConditionFailure(err)) throw conflict();
      throw err;
    }
  }

  private event(id: string, at: string, data: Item) {
    return {
      Put: {
        TableName: this.table,
        Item: { ...eventKey(id, at, randomUUID().slice(0, 8)), ...data },
      },
    };
  }

  async setState(id: string, state: ReaderState): Promise<IssueListItem> {
    const item = await this.mustGetIssue(id);
    if (item.state === state) return toListItem(item);
    const now = new Date().toISOString();
    // Archiving a saved issue takes it off the Saved list too (#43): done with it.
    const unsave = state === "archived" && item.savedAt !== undefined;
    const savedAt = unsave ? undefined : (item.savedAt as string | undefined);
    const idx = issueIndexAttributes({
      id,
      senderId: item.senderId as string,
      receivedAt: item.receivedAt as string,
      state,
      rating: item.rating as Rating | undefined,
      ratedAt: item.ratedAt as string | undefined,
      savedAt,
    });
    const u = updateExpression({ state, stateChangedAt: now, ...idx.set }, [
      ...idx.remove,
      ...(unsave ? ["savedAt"] : []),
    ]);
    await this.transact([
      {
        Update: {
          TableName: this.table,
          Key: issueKey(id),
          UpdateExpression: u.expr,
          ConditionExpression: "#cur = :cur",
          ExpressionAttributeNames: { ...u.names, "#cur": "state" },
          ExpressionAttributeValues: { ...u.values, ":cur": item.state },
        },
      },
      this.event(id, now, { type: "state", value: state, prev: item.state }),
      ...(unsave ? [this.event(id, now, { type: "saved", value: false, prev: true })] : []),
    ]);
    return toListItem({ ...item, state, savedAt });
  }

  /**
   * Save an issue for later, or take it off the Saved list (#43). Saved issues leave Unread
   * whatever their state, and the archive rules skip them. An archived issue cannot be saved:
   * archiving is the end of the Saved list.
   */
  async setSaved(id: string, saved: boolean): Promise<IssueListItem> {
    const item = await this.mustGetIssue(id);
    if ((item.savedAt !== undefined) === saved) return toListItem(item);
    if (saved && item.state === "archived") throw badRequest("archived issues cannot be saved");
    const now = new Date().toISOString();
    const savedAt = saved ? now : undefined;
    const idx = issueIndexAttributes({
      id,
      senderId: item.senderId as string,
      receivedAt: item.receivedAt as string,
      state: item.state as IssueState,
      rating: item.rating as Rating | undefined,
      ratedAt: item.ratedAt as string | undefined,
      savedAt,
    });
    const u = updateExpression({ ...idx.set, ...(saved ? { savedAt: now } : {}) }, [
      ...idx.remove,
      ...(saved ? [] : ["savedAt"]),
    ]);
    await this.transact([
      {
        Update: {
          TableName: this.table,
          Key: issueKey(id),
          UpdateExpression: u.expr,
          // The indexes follow the state read above; another device may have changed either.
          ConditionExpression: `${saved ? "attribute_not_exists" : "attribute_exists"}(#sv) AND #st = :st`,
          ExpressionAttributeNames: { ...u.names, "#sv": "savedAt", "#st": "state" },
          ExpressionAttributeValues: { ...u.values, ":st": item.state },
        },
      },
      this.event(id, now, { type: "saved", value: saved, prev: !saved }),
    ]);
    return toListItem({ ...item, savedAt });
  }

  /**
   * Sandip moves an issue. Its stories move with it (#81), each as his own move, and the issue's
   * shelf follows them; an issue with no stories is moved itself.
   */
  async setShelf(id: string, shelf: Shelf): Promise<IssueListItem> {
    const [item, stories] = await Promise.all([this.mustGetIssue(id), this.storyShelves(id)]);
    const now = new Date().toISOString();
    const event = this.event(id, now, {
      type: "shelf",
      value: shelf,
      prev: (item.shelf as string) ?? null,
    });
    if (!stories.length) {
      if (item.shelf === shelf && item.shelfSetBy === "sandip") return toListItem(item);
      await this.transact([
        {
          Update: {
            TableName: this.table,
            Key: issueKey(id),
            UpdateExpression: "SET #sh = :sh, #by = :by",
            ConditionExpression: "attribute_exists(pk)",
            ExpressionAttributeNames: { "#sh": "shelf", "#by": "shelfSetBy" },
            ExpressionAttributeValues: { ":sh": shelf, ":by": "sandip" },
          },
        },
        event,
      ]);
      return toListItem({ ...item, shelf, shelfSetBy: "sandip" });
    }
    const moving = stories.filter((s) => s.shelf !== shelf || s.shelfSetBy !== "sandip");
    if (!moving.length && item.shelf === shelf) return toListItem(item);
    for (const s of moving) await this.putStoryShelf(id, s, shelf, "sandip");
    await this.transact([
      {
        Update: {
          TableName: this.table,
          Key: issueKey(id),
          UpdateExpression: "SET #sh = :sh, #by = :by",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeNames: { "#sh": "shelf", "#by": "shelfSetBy" },
          ExpressionAttributeValues: { ":sh": shelf, ":by": "stories" },
        },
      },
      event,
    ]);
    return toListItem({ ...item, shelf, shelfSetBy: "stories" });
  }

  // ---------- story shelves (#81) ----------

  /** An issue's stories with their shelf fields and state, read fresh. */
  private storyShelves(id: string): Promise<Item[]> {
    return this.queryAll({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :story)",
      ExpressionAttributeValues: { ":pk": issueKey(id).pk, ":story": "STORY#" },
      ProjectionExpression: "#n, receivedAt, shelf, shelfSetBy, learning, #st",
      ExpressionAttributeNames: { "#n": "n", "#st": "state" },
      ConsistentRead: true,
    });
  }

  /**
   * Put a story on a shelf with the Learning index that follows, provided its state is still the
   * one `s` was read with (a 409 otherwise).
   */
  private async putStoryShelf(id: string, s: Item, shelf: Shelf, by: StoryShelfSetBy) {
    const state = s.state as StoryState | undefined;
    const index = storyIndexAttributes({
      issueId: id,
      n: s.n as number,
      receivedAt: s.receivedAt as string,
      shelf,
      state,
    });
    const u = updateExpression({ shelf, shelfSetBy: by, ...index.set }, index.remove);
    try {
      await this.ddb.send(
        new UpdateCommand({
          TableName: this.table,
          Key: storyKey(id, s.n as number),
          UpdateExpression: u.expr,
          ConditionExpression:
            "attribute_exists(pk) AND " + (state ? "#cst = :cst" : "attribute_not_exists(#cst)"),
          ExpressionAttributeNames: { ...u.names, "#cst": "state" },
          ExpressionAttributeValues: { ...u.values, ...(state ? { ":cst": state } : {}) },
        }),
      );
    } catch (err) {
      if (isConditionFailure(err)) throw conflict();
      throw err;
    }
  }

  /** Set an issue's shelf from its stories' (#81). Undefined for an issue with no stories. */
  private async deriveIssueShelf(id: string): Promise<Shelf | undefined> {
    const shelf = issueShelf(
      (await this.storyShelves(id)).map((s) => s.shelf as Shelf | undefined),
    );
    if (!shelf) return undefined;
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.table,
        Key: issueKey(id),
        UpdateExpression: "SET shelf = :s, shelfSetBy = :by",
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeValues: { ":s": shelf, ":by": "stories" },
      }),
    );
    return shelf;
  }

  async setRating(id: string, value: Rating | 0): Promise<IssueListItem> {
    const item = await this.mustGetIssue(id);
    const prev = (item.rating as Rating | undefined) ?? 0;
    if (prev === value) return toListItem(item);

    const now = new Date().toISOString();
    const rating = value === 0 ? undefined : value;
    const idx = issueIndexAttributes({
      id,
      senderId: item.senderId as string,
      receivedAt: item.receivedAt as string,
      state: item.state as IssueState,
      rating,
      ratedAt: rating ? now : undefined,
      savedAt: item.savedAt as string | undefined,
    });
    const u = updateExpression({ ...idx.set, ...(rating ? { rating, ratedAt: now } : {}) }, [
      ...idx.remove,
      ...(rating ? [] : ["rating", "ratedAt"]),
    ]);
    const du = (value === 1 ? 1 : 0) - (prev === 1 ? 1 : 0);
    const dd = (value === -1 ? 1 : 0) - (prev === -1 ? 1 : 0);

    await this.transact([
      {
        Update: {
          TableName: this.table,
          Key: issueKey(id),
          UpdateExpression: u.expr,
          // Optimistic: whatever we read must still be there (another device may have rated).
          ConditionExpression: prev === 0 ? "attribute_not_exists(#cur)" : "#cur = :cur",
          ExpressionAttributeNames: { ...u.names, "#cur": "rating" },
          ExpressionAttributeValues: { ...u.values, ...(prev === 0 ? {} : { ":cur": prev }) },
        },
      },
      {
        Update: {
          TableName: this.table,
          Key: senderItemKey(item.senderId as string),
          UpdateExpression: "ADD up :du, down :dd",
          ExpressionAttributeValues: { ":du": du, ":dd": dd },
        },
      },
      this.event(id, now, { type: "rating", value, prev }),
    ]);
    return toListItem({ ...item, rating });
  }

  async logOpen(id: string): Promise<void> {
    const [, place] = await Promise.all([this.mustGetIssue(id), this.nowReadingItem()]);
    const now = new Date().toISOString();
    // Indexed by time for read history (#42).
    const open = { type: "open", ...openIndexAttributes(id, now) };
    // Now reading (#44) points at the issue opened last. Reopening it keeps the place, unless it
    // was finished: then it starts again from the top.
    const kept = place?.issueId === id ? (place.position as number) : 0;
    await Promise.all([
      this.ddb.send(new PutCommand(this.event(id, now, open).Put)),
      this.putNowReading(id, kept < 1 ? kept : 0, now),
    ]);
  }

  /**
   * A peek left open (#56) is a read too: indexed by time like an open, so read history lists the
   * issue. Now reading stays where it is, since a peek has no place to come back to.
   */
  async logPeek(id: string): Promise<void> {
    await this.mustGetIssue(id);
    const now = new Date().toISOString();
    const peek = { type: "peek", ...openIndexAttributes(id, now) };
    await this.ddb.send(new PutCommand(this.event(id, now, peek).Put));
  }

  // ---------- now reading (#44) ----------

  private async nowReadingItem(): Promise<Item | undefined> {
    const res = await this.ddb.send(
      new GetCommand({ TableName: this.table, Key: NOW_READING_KEY }),
    );
    return res.Item;
  }

  /** Point Now reading at an issue from `now`: rating it after that hides it. */
  private async putNowReading(id: string, position: number, now: string): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.table,
        Item: { ...NOW_READING_KEY, issueId: id, position, since: now, at: now },
      }),
    );
  }

  /**
   * Save the place in an issue, 0 to 1, where 1 means finished. Usually the issue Now reading
   * already points at. A place saved in another issue means it is being read again (an older
   * window, after another device opened something), so Now reading moves back to it; finishing
   * such an issue leaves Now reading alone.
   */
  async savePosition(id: string, position: number): Promise<void> {
    const now = new Date().toISOString();
    try {
      await this.ddb.send(
        new UpdateCommand({
          TableName: this.table,
          Key: NOW_READING_KEY,
          UpdateExpression: "SET #p = :p, #at = :at",
          ConditionExpression: "#id = :id",
          ExpressionAttributeNames: { "#p": "position", "#at": "at", "#id": "issueId" },
          ExpressionAttributeValues: { ":p": position, ":at": now, ":id": id },
        }),
      );
    } catch (err) {
      if (!isConditionFailure(err)) throw err;
      await this.mustGetIssue(id);
      if (position < 1) await this.putNowReading(id, position, now);
    }
  }

  /** The issue to come back to, unless it was finished, archived, or rated after it was opened. */
  async nowReading(): Promise<NowReadingResponse> {
    const place = await this.nowReadingItem();
    if (!place || (place.position as number) >= 1) return {};
    const res = await this.ddb.send(
      new GetCommand({ TableName: this.table, Key: issueKey(place.issueId as string) }),
    );
    const item = res.Item;
    if (!item || item.state === "filtered" || item.state === "archived") return {};
    if (item.rating && (item.ratedAt as string) >= (place.since as string)) return {};
    return {
      nowReading: {
        issue: toListItem(item),
        position: place.position as number,
        at: place.at as string,
      },
    };
  }

  // ---------- read history (#42) ----------

  /**
   * The issues read on a reader's day (opened, or peeked at, #56), each once at its latest read,
   * latest first, with the nearest earlier and later days that have reads (so paging skips empty
   * days).
   */
  async history(day: string): Promise<HistoryResponse> {
    const { from, to } = readerDayBounds(day);
    const [opens, before, after, senders] = await Promise.all([
      this.opensBetween(from, to),
      this.nearestOpen(from, "before"),
      this.nearestOpen(to, "after"),
      this.listSenders(),
    ]);
    const latest = new Map<string, { at: string; via: HistoryItem["via"] }>();
    for (const o of opens) {
      if ((latest.get(o.id)?.at ?? "") < o.at) latest.set(o.id, { at: o.at, via: o.via });
    }
    const starred = new Set(senders.filter((s) => s.mustRead).map((s) => s.senderId));
    const issues = await this.batchGet([...latest.keys()].map(issueKey), LIST_ATTRIBUTES);
    const items: HistoryItem[] = issues
      // An issue opened and later found to be account mail (#50) is no longer an issue.
      .filter((i) => i.state !== "filtered")
      .map((i) => ({
        ...toListItem(i),
        ...(starred.has(i.senderId as string) ? { mustRead: true } : {}),
        openedAt: latest.get(i.id as string)!.at,
        via: latest.get(i.id as string)!.via,
      }))
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    return {
      day,
      items,
      ...(before ? { previousDay: readerDay(Date.parse(before)) } : {}),
      ...(after ? { nextDay: readerDay(Date.parse(after)) } : {}),
    };
  }

  /** Opens and peeks between two instants (inclusive), from the `OPENS` partition of `gsi1`. */
  private async opensBetween(
    from: string,
    to: string,
  ): Promise<{ id: string; at: string; via: HistoryItem["via"] }[]> {
    const out: { id: string; at: string; via: HistoryItem["via"] }[] = [];
    let start: Item | undefined;
    do {
      const res: QueryCommandOutput = await this.query({
        IndexName: INDEX.list,
        KeyConditionExpression: "gsi1pk = :p AND gsi1sk BETWEEN :from AND :to",
        ExpressionAttributeValues: { ":p": PARTITION.opens, ":from": from, ":to": `${to}\uffff` },
        ProjectionExpression: "gsi1sk, #t",
        ExpressionAttributeNames: { "#t": "type" },
        ExclusiveStartKey: start,
      });
      for (const i of res.Items ?? []) {
        const [at, id] = (i.gsi1sk as string).split("#");
        out.push({ id: id!, at: at!, via: i.type === "peek" ? "peek" : "open" });
      }
      start = res.LastEvaluatedKey;
    } while (start);
    return out;
  }

  /** The time of the last read before `edge`, or the first after it. */
  private async nearestOpen(edge: string, side: "before" | "after"): Promise<string | undefined> {
    const res = await this.query({
      IndexName: INDEX.list,
      KeyConditionExpression:
        side === "before" ? "gsi1pk = :p AND gsi1sk < :edge" : "gsi1pk = :p AND gsi1sk > :edge",
      ExpressionAttributeValues: {
        ":p": PARTITION.opens,
        ":edge": side === "before" ? edge : `${edge}\uffff`,
      },
      ProjectionExpression: "gsi1sk",
      ScanIndexForward: side === "after",
      Limit: 1,
    });
    const sk = res.Items?.[0]?.gsi1sk as string | undefined;
    return sk?.split("#")[0];
  }

  // ---------- stories (#15, #41) ----------

  /** The issue's stories from the story index, in the order they appear in it. */
  async stories(id: string): Promise<IssueStoriesResponse> {
    const [, res] = await Promise.all([
      this.mustGetIssue(id),
      this.query({
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :story)",
        ExpressionAttributeValues: { ":pk": issueKey(id).pk, ":story": "STORY#" },
        // Not the embedding: a few lines of text each.
        ProjectionExpression: "#n, #h, #s, #l, #nm",
        ExpressionAttributeNames: {
          "#n": "n",
          "#h": "headline",
          "#s": "summary",
          "#l": "link",
          "#nm": "names",
        },
      }),
    ]);
    const stories: IssueStory[] = (res.Items ?? []).map((s) => {
      const names = Array.isArray(s.names) ? (s.names as string[]) : [];
      return {
        n: s.n as number,
        headline: s.headline as string,
        summary: s.summary as string,
        ...(typeof s.link === "string" ? { link: s.link } : {}),
        ...(names.length ? { names } : {}),
      };
    });
    return { stories: stories.sort((a, b) => a.n - b.n) };
  }

  /** The issue's stories with their embeddings (#20), read now; any without one are left out. */
  async storyVectors(id: string): Promise<OwnStory[]> {
    const res = await this.query({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :story)",
      ExpressionAttributeValues: { ":pk": issueKey(id).pk, ":story": "STORY#" },
      ProjectionExpression: "#n, #h, #sid, #at, #v",
      ExpressionAttributeNames: {
        "#n": "n",
        "#h": "headline",
        "#sid": "senderId",
        "#at": "receivedAt",
        "#v": "vector",
      },
    });
    return (res.Items ?? []).flatMap((s) => {
      const vector = s.vector instanceof Uint8Array ? toVector(s.vector) : undefined;
      if (vector?.length !== EMBED_DIMENSIONS || typeof s.receivedAt !== "string") return [];
      return [
        {
          issueId: id,
          n: s.n as number,
          headline: s.headline as string,
          senderId: s.senderId as string,
          receivedAt: s.receivedAt,
          vector,
        },
      ];
    });
  }

  // ---------- how this evolved (#19) ----------

  /** One story with its embedding and event, and its issue's newsletter, read now. */
  async timelineStory(id: string, n: number): Promise<TimelineStory | undefined> {
    const [issue, story] = await Promise.all([
      this.ddb.send(
        new GetCommand({
          TableName: this.table,
          Key: issueKey(id),
          ProjectionExpression: "#pub, #c",
          ExpressionAttributeNames: { "#pub": "publication", "#c": "storyCount" },
        }),
      ),
      this.ddb.send(new GetCommand({ TableName: this.table, Key: storyKey(id, n) })),
    ]);
    const s = story.Item;
    if (!issue.Item || !s || typeof s.receivedAt !== "string") return undefined;
    const vector = s.vector instanceof Uint8Array ? toVector(s.vector) : undefined;
    return {
      issueId: id,
      n,
      senderId: s.senderId as string,
      receivedAt: s.receivedAt,
      // Without an embedding nothing is close, and there is no timeline to tell.
      vector: vector?.length === EMBED_DIMENSIONS ? vector : new Float32Array(0),
      headline: s.headline as string,
      summary: (s.summary as string | undefined) ?? "",
      names: (s.names as string[] | undefined) ?? [],
      eventId: (s.eventId as string | undefined) ?? storyRef(id, n),
      publication: issue.Item.publication as string,
      digest: ((issue.Item.storyCount as number | undefined) ?? 0) > 1,
    };
  }

  /** The timeline kept for an event, if one was written. */
  async getTimeline(eventId: string): Promise<Timeline | undefined> {
    const res = await this.ddb.send(
      new GetCommand({ TableName: this.table, Key: timelineKey(eventId) }),
    );
    const t = res.Item;
    if (!t) return undefined;
    return {
      gist: t.gist as string,
      points: t.points as Timeline["points"],
      at: t.at as string,
      stories: t.stories as number,
      ms: t.ms as number,
      cents: t.cents as number,
    };
  }

  /** Keeps a timeline for its event, replacing any earlier one. */
  async putTimeline(eventId: string, timeline: StoredTimeline): Promise<void> {
    await this.ddb.send(
      new PutCommand({ TableName: this.table, Item: { ...timelineKey(eventId), ...timeline } }),
    );
  }

  // ---------- search (#53) and related stories (#20) ----------

  /** The corpus: every listed issue's words, and every story with its embedding. */
  async readCorpus(): Promise<{ issues: CorpusIssue[]; stories: CorpusStory[] }> {
    const words = {
      ProjectionExpression: "#id, #sid, #pub, #sub, #sum, #promo, #at",
      ExpressionAttributeNames: {
        "#id": "id",
        "#sid": "senderId",
        "#pub": "publication",
        "#sub": "subject",
        "#sum": "summary",
        "#promo": "promo",
        "#at": "receivedAt",
      },
    };
    const [inbox, archive, stories] = await Promise.all([
      this.queryAll({ ...words, ...this.partition(PARTITION.inbox) }),
      this.queryAll({ ...words, ...this.partition(PARTITION.archive) }),
      this.everyStory(),
    ]);
    const issues: CorpusIssue[] = [...inbox, ...archive].map((i) => ({
      id: i.id as string,
      senderId: i.senderId as string,
      publication: i.publication as string,
      subject: i.subject as string,
      summary: i.summary as string | undefined,
      promo: i.promo === true,
      receivedAt: i.receivedAt as string,
    }));
    return { issues, stories };
  }

  /** These issues as list rows, read now (#53); any filtered since they were found are left out. */
  async listItems(ids: string[]): Promise<IssueListItem[]> {
    const items = await this.batchGet(ids.map(issueKey), LIST_ATTRIBUTES);
    return items.filter((i) => i.state !== "filtered").map(toListItem);
  }

  /**
   * Every story with its embedding: about 5 MB for 2,200 stories, so read a week at a time, eight
   * weeks at once, rather than one 1 MB page after another.
   */
  private async everyStory(): Promise<CorpusStory[]> {
    const first = await this.query({
      ...this.partition(PARTITION.stories),
      ProjectionExpression: "gsi1sk",
      Limit: 1,
    });
    const oldest = first.Items?.[0]?.gsi1sk as string | undefined;
    if (!oldest) return [];
    const WEEK = 7 * 86_400_000;
    const weeks: string[] = [];
    for (let t = Date.parse(oldest.slice(0, 10)); t <= Date.now() + 86_400_000; t += WEEK) {
      weeks.push(new Date(t).toISOString());
    }
    const out: CorpusStory[] = [];
    for (let i = 0; i < weeks.length; i += 8) {
      const slices = await Promise.all(
        weeks.slice(i, i + 8).map((from) =>
          this.queryAll({
            IndexName: INDEX.list,
            // Sort keys are "<receivedAt>#<id>#<nn>", so none equals a week's bound.
            KeyConditionExpression: "gsi1pk = :p AND gsi1sk BETWEEN :from AND :to",
            ExpressionAttributeValues: {
              ":p": PARTITION.stories,
              ":from": from,
              ":to": new Date(Date.parse(from) + WEEK).toISOString(),
            },
            ProjectionExpression: "#id, #n, #h, #s, #names, #v",
            ExpressionAttributeNames: {
              "#id": "id",
              "#n": "n",
              "#h": "headline",
              "#s": "summary",
              "#names": "names",
              "#v": "vector",
            },
          }),
        ),
      );
      for (const s of slices.flat()) {
        const vector = s.vector instanceof Uint8Array ? toVector(s.vector) : undefined;
        out.push({
          id: s.id as string,
          n: s.n as number,
          headline: s.headline as string,
          summary: (s.summary as string | undefined) ?? "",
          names: (s.names as string[] | undefined) ?? [],
          ...(vector?.length === EMBED_DIMENSIONS ? { vector } : {}),
        });
      }
    }
    return out;
  }

  private partition(p: string) {
    return {
      IndexName: INDEX.list,
      KeyConditionExpression: "gsi1pk = :p",
      ExpressionAttributeValues: { ":p": p },
    };
  }

  /** Every page of a query. */
  private async queryAll(input: Omit<QueryCommandInput, "TableName">): Promise<Item[]> {
    const out: Item[] = [];
    let start: Item | undefined;
    do {
      const res: QueryCommandOutput = await this.query({ ...input, ExclusiveStartKey: start });
      out.push(...(res.Items ?? []));
      start = res.LastEvaluatedKey;
    } while (start);
    return out;
  }

  // ---------- senders ----------

  async listSenders(): Promise<SenderListItem[]> {
    const items: Item[] = [];
    let start: Item | undefined;
    do {
      const res: QueryCommandOutput = await this.query({
        IndexName: INDEX.list,
        KeyConditionExpression: "gsi1pk = :p",
        ExpressionAttributeValues: { ":p": PARTITION.senders },
        ExclusiveStartKey: start,
      });
      items.push(...(res.Items ?? []));
      start = res.LastEvaluatedKey;
    } while (start);
    return items.map(toSender);
  }

  async getSender(senderId: string): Promise<SenderDetailResponse> {
    const res = await this.ddb.send(
      new GetCommand({ TableName: this.table, Key: senderItemKey(senderId) }),
    );
    if (!res.Item) throw notFound("sender not found");
    const issues = await this.query({
      IndexName: INDEX.bySender,
      KeyConditionExpression: "gsi3pk = :p",
      ExpressionAttributeValues: { ":p": `SENDER#${senderId}` },
      ScanIndexForward: false,
      Limit: 100,
    });
    return {
      ...toSender(res.Item),
      addresses: [...((res.Item.addresses as Set<string> | undefined) ?? [])].sort(),
      issues: (issues.Items ?? []).map(toListItem),
    };
  }

  async updateSender(senderId: string, patch: SenderPatch): Promise<SenderListItem> {
    const { shelf, ...flags } = patch;
    const set: Record<string, unknown> = { ...flags, ...(shelf ? { shelf } : {}) };
    const u = updateExpression(set, shelf === null ? ["shelf"] : []);
    try {
      const res = await this.ddb.send(
        new UpdateCommand({
          TableName: this.table,
          Key: senderItemKey(senderId),
          UpdateExpression: u.expr,
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeNames: u.names,
          // A patch that only clears the shelf has no values, and DynamoDB rejects an empty map.
          ExpressionAttributeValues: Object.keys(u.values).length ? u.values : undefined,
          ReturnValues: "ALL_NEW",
        }),
      );
      if (shelf !== undefined) await this.reshelveSender(senderId, shelf);
      return toSender(res.Attributes!);
    } catch (err) {
      if (isConditionFailure(err)) throw notFound("sender not found");
      throw err;
    }
  }

  /**
   * Apply a sender's "always" shelf to its stories, and its issues follow (#81); clearing it hands
   * each story back to Jev's call. Sandip's moves keep his choice. An issue with no stories takes
   * the setting itself, and goes back to Claude's call before #81 when it is cleared.
   */
  private async reshelveSender(senderId: string, shelf: Shelf | null): Promise<void> {
    const issues = await this.queryAll({
      IndexName: INDEX.bySender,
      KeyConditionExpression: "gsi3pk = :p",
      ExpressionAttributeValues: { ":p": `SENDER#${senderId}` },
      ProjectionExpression: "id, shelfAuto, shelfSetBy",
    });

    const names = { "#sh": "shelf", "#by": "shelfSetBy" };
    const unstoried = (i: Item) => {
      const by = i.shelfSetBy as ShelfSetBy | undefined;
      if (by === "sandip") return undefined;
      if (shelf) {
        return {
          UpdateExpression: "SET #sh = :sh, #by = :by",
          ConditionExpression: "attribute_not_exists(#by) OR #by <> :sandip",
          ExpressionAttributeValues: { ":sh": shelf, ":by": "sender", ":sandip": "sandip" },
        };
      }
      if (by !== "sender") return undefined;
      return i.shelfAuto
        ? {
            UpdateExpression: "SET #sh = :sh, #by = :by",
            ConditionExpression: "#by = :sender",
            ExpressionAttributeValues: { ":sh": i.shelfAuto, ":by": "claude", ":sender": "sender" },
          }
        : {
            UpdateExpression: "REMOVE #sh, #by",
            ConditionExpression: "#by = :sender",
            ExpressionAttributeValues: { ":sender": "sender" },
          };
    };
    const reshelve = async (i: Item) => {
      const id = i.id as string;
      const stories = await this.storyShelves(id);
      if (!stories.length) {
        const u = unstoried(i);
        if (!u) return;
        await this.ddb
          .send(
            new UpdateCommand({
              TableName: this.table,
              Key: issueKey(id),
              ExpressionAttributeNames: names,
              ...u,
            }),
          )
          .catch((err: unknown) => {
            // Sandip moved it in the meantime: his choice stands.
            if (!isConditionFailure(err)) throw err;
          });
        return;
      }
      for (const s of stories) {
        const next = storyShelf(
          {
            shelf: s.shelf as Shelf | undefined,
            shelfSetBy: s.shelfSetBy as StoryShelfSetBy | undefined,
            learning: s.learning as number | undefined,
          },
          shelf ?? undefined,
        );
        if (!next.shelf || (next.shelf === s.shelf && next.shelfSetBy === s.shelfSetBy)) continue;
        await this.putStoryShelf(id, s, next.shelf, next.shelfSetBy!);
      }
      await this.deriveIssueShelf(id);
    };
    for (let n = 0; n < issues.length; n += 5) {
      await Promise.all(issues.slice(n, n + 5).map(reshelve));
    }
  }

  async listTopics(): Promise<Topic[]> {
    const res = await this.ddb.send(new GetCommand({ TableName: this.table, Key: TOPICS_KEY }));
    return (res.Item?.topics as Topic[] | undefined) ?? [];
  }

  // ---------- counts and summary ----------

  /**
   * Unread issues counted by sender, shelf and topic (muted senders are included), and how many
   * are saved for later (#43).
   */
  async unreadCounts(): Promise<UnreadCountsResponse> {
    const saved = this.countSaved();
    const tally = new Map<string, UnreadCount>();
    let start: Item | undefined;
    do {
      const res: QueryCommandOutput = await this.query({
        IndexName: INDEX.unread,
        KeyConditionExpression: "gsi2pk = :p",
        ProjectionExpression: "#sid, #sh, #tp",
        ExpressionAttributeNames: { "#sid": "senderId", "#sh": "shelf", "#tp": "topic" },
        ExpressionAttributeValues: { ":p": PARTITION.unread },
        ExclusiveStartKey: start,
      });
      for (const i of res.Items ?? []) {
        const key = `${i.senderId}|${i.shelf ?? ""}|${i.topic ?? ""}`;
        const t = tally.get(key);
        if (t) t.n++;
        else {
          tally.set(key, {
            senderId: i.senderId as string,
            shelf: i.shelf as Shelf | undefined,
            topic: i.topic as string | undefined,
            n: 1,
          });
        }
      }
      start = res.LastEvaluatedKey;
    } while (start);
    return { counts: [...tally.values()], saved: await saved };
  }

  private async countSaved(): Promise<number> {
    let n = 0;
    let start: Item | undefined;
    do {
      const res: QueryCommandOutput = await this.query({
        IndexName: INDEX.unread,
        KeyConditionExpression: "gsi2pk = :p",
        ExpressionAttributeValues: { ":p": PARTITION.saved },
        Select: "COUNT",
        ExclusiveStartKey: start,
      });
      n += res.Count ?? 0;
      start = res.LastEvaluatedKey;
    } while (start);
    return n;
  }

  /**
   * The most relevant unread News from the last two weeks, best first and at most three from one
   * newsletter, scored at read time (docs/architecture.md section 11). Nothing is stored.
   */
  async summary(limit = 20): Promise<SummaryResponse> {
    const now = Date.now();
    const since = new Date(now - CANDIDATE_DAYS * 86_400_000).toISOString();
    const [senders, interests, rated] = await Promise.all([
      this.listSenders(),
      this.interestVectors(),
      this.ratedIssues(),
    ]);
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const starred = new Set(senders.filter((s) => s.mustRead).map((s) => s.senderId));

    const news = shelfFilter("news");
    const items: Item[] = [];
    let start: Item | undefined;
    do {
      const res: QueryCommandOutput = await this.query({
        IndexName: INDEX.unread,
        KeyConditionExpression: "gsi2pk = :p AND gsi2sk > :since",
        FilterExpression: news.expr,
        ExpressionAttributeNames: news.names,
        ExpressionAttributeValues: { ":p": PARTITION.unread, ":since": since, ...news.values },
        ExclusiveStartKey: start,
      });
      items.push(...(res.Items ?? []).filter((i) => !muted.has(i.senderId as string)));
      start = res.LastEvaluatedKey;
    } while (start);

    const vectors = await this.embeddings([
      ...items.map((i) => i.id as string),
      ...rated.map((r) => r.id),
    ]);
    const ranked = rank({
      candidates: items.map((i) => ({
        id: i.id as string,
        senderId: i.senderId as string,
        receivedAt: i.receivedAt as string,
        vector: vectors.get(i.id as string),
      })),
      senders: new Map(
        senders.map((s) => [s.senderId, { mustRead: s.mustRead, up: s.up, down: s.down }]),
      ),
      interests,
      rated: rated.flatMap((r) => {
        const vector = vectors.get(r.id);
        return vector ? [{ ...r, vector }] : [];
      }),
      now,
      day: readerDay(now),
    });
    const byId = new Map(items.map((i) => [i.id as string, i]));
    const picked = pickTop(ranked, limit);
    const day = readerDay(now);
    const [digest, digestStats, narrative] = await Promise.all([
      this.todaysDigest(
        day,
        picked.slice(0, DIGEST_SIZE).map((r) => r.id),
      ),
      this.digestStats(now),
      this.narrative(now),
    ]);
    return {
      digest: digest?.ids ?? [],
      ...(digest ? { digestAt: digest.at } : {}),
      digestStats,
      ...(narrative ? { narrative } : {}),
      items: picked.map((r) => {
        const item = toListItem(byId.get(r.id)!);
        return {
          ...item,
          scoreReason: r.reason,
          ...(starred.has(item.senderId) ? { mustRead: true } : {}),
        };
      }),
      candidates: items.length,
    };
  }

  /**
   * Issues related to `id` as a whole (#20, first version): nearest neighbours over every stored
   * issue's embedding, at read time, for an issue not split into stories. Promos and muted
   * newsletters stay out. Fine to a few thousand issues; past that, keep the vectors packed in
   * one object instead of reading them item by item.
   */
  async relatedIssues(id: string): Promise<RelatedResponse> {
    const [items, senders] = await Promise.all([this.everyIssue(), this.listSenders()]);
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const vectors = await this.embeddings(
      items.map((i) => i.id as string),
      true,
    );
    const byId = new Map(items.map((i) => [i.id as string, i]));
    const res = relatedIssues(
      id,
      items.flatMap((i) => {
        const vector = vectors.get(i.id as string);
        return vector
          ? [
              {
                id: i.id as string,
                senderId: i.senderId as string,
                receivedAt: i.receivedAt as string,
                vector,
              },
            ]
          : [];
      }),
      { eligible: (c) => !muted.has(c.senderId) && byId.get(c.id)?.promo !== true },
    );
    const item = (m: RelatedMatch): RelatedItem => ({
      ...toListItem(byId.get(m.id)!),
      similarity: Math.round(m.similarity * 1000) / 1000,
    });
    return { earlier: res.earlier.map(item), since: res.since.map(item) };
  }

  /** Every issue that is not filtered out: the inbox and the archive. */
  private async everyIssue(): Promise<Item[]> {
    const out: Item[] = [];
    for (const partition of [PARTITION.inbox, PARTITION.archive]) {
      let start: Item | undefined;
      do {
        const res: QueryCommandOutput = await this.query({
          IndexName: INDEX.list,
          KeyConditionExpression: "gsi1pk = :p",
          ExpressionAttributeValues: { ":p": partition },
          ExclusiveStartKey: start,
        });
        out.push(...(res.Items ?? []));
        start = res.LastEvaluatedKey;
      } while (start);
    }
    return out;
  }

  /**
   * Today's digest (#5): the Summary's top 5 the first time it is shown in the reader's day, kept
   * as shown so the success measure can check them later. Later calls return what was logged.
   */
  private async todaysDigest(
    day: string,
    top: string[],
  ): Promise<{ ids: string[]; at: string } | undefined> {
    const logged = async () => {
      const item = (
        await this.ddb.send(new GetCommand({ TableName: this.table, Key: digestKey(day) }))
      ).Item;
      return item && { ids: (item.ids as string[] | undefined) ?? [], at: item.at as string };
    };
    const found = await logged();
    if (found) return found;
    if (!top.length) return undefined;
    const at = new Date().toISOString();
    try {
      await this.ddb.send(
        new PutCommand({
          TableName: this.table,
          Item: { ...digestKey(day), ids: top, at },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return { ids: top, at };
    } catch (err) {
      // Another request logged today's first.
      if (!isConditionFailure(err)) throw err;
      return (await logged()) ?? { ids: top, at };
    }
  }

  /** The latest narrative of the day's news (#18), if it was written in the last 24 hours. */
  private async narrative(now: number): Promise<Narrative | undefined> {
    const res = await this.ddb.send(new GetCommand({ TableName: this.table, Key: NARRATIVE_KEY }));
    const n = res.Item;
    if (!n || now - Date.parse(n.at as string) > 24 * 3_600_000) return undefined;
    return {
      at: n.at as string,
      threads: n.threads as Narrative["threads"],
      stories: n.stories as number,
      newsletters: n.newsletters as number,
    };
  }

  /**
   * The success measure (#5): of the issues in the last 14 days' digests (each counted once),
   * how many have a thumbs up (useful) and a thumbs down by now. The PRD's aim: 3 of every 5 up.
   */
  private async digestStats(now = Date.now()): Promise<DigestStats> {
    const digests = await this.batchGet(recentDays(now, DIGEST_DAYS).map(digestKey), ["ids"]);
    const ids = [...new Set(digests.flatMap((d) => (d.ids as string[] | undefined) ?? []))];
    const rated = await this.batchGet(ids.map(issueKey), ["rating"]);
    return {
      days: digests.length,
      shown: ids.length,
      useful: rated.filter((i) => i.rating === 1).length,
      notUseful: rated.filter((i) => i.rating === -1).length,
    };
  }

  /** BatchGetItem in chunks of 100, retrying what DynamoDB leaves unprocessed. */
  private async batchGet(keys: Record<string, unknown>[], attributes: string[]): Promise<Item[]> {
    const out: Item[] = [];
    const names = Object.fromEntries(attributes.map((a, i) => [`#a${i}`, a]));
    for (let n = 0; n < keys.length; n += 100) {
      let todo: Record<string, unknown>[] | undefined = keys.slice(n, n + 100);
      for (let attempt = 0; todo?.length && attempt < 5; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
        const res: BatchGetCommandOutput = await this.ddb.send(
          new BatchGetCommand({
            RequestItems: {
              [this.table]: {
                Keys: todo,
                ProjectionExpression: Object.keys(names).join(", "),
                ExpressionAttributeNames: names,
              },
            },
          }),
        );
        out.push(...(res.Responses?.[this.table] ?? []));
        todo = res.UnprocessedKeys?.[this.table]?.Keys;
      }
    }
    return out;
  }

  /** The five interests' embeddings, written by enrichment; empty until the first run. */
  private async interestVectors(): Promise<InterestVector[]> {
    const res = await this.ddb.send(new GetCommand({ TableName: this.table, Key: INTERESTS_KEY }));
    const list = (res.Item?.interests as { name: string; vector: Uint8Array }[] | undefined) ?? [];
    return list.map((i) => ({ name: i.name, vector: toVector(i.vector) }));
  }

  /** The most recent ratings (the taste profile fades them over 60 days anyway). */
  private async ratedIssues() {
    const res = await this.query({
      IndexName: INDEX.rated,
      KeyConditionExpression: "gsi4pk = :p",
      ProjectionExpression: "#id, #r, #at, #sub",
      ExpressionAttributeNames: {
        "#id": "id",
        "#r": "rating",
        "#at": "ratedAt",
        "#sub": "subject",
      },
      ExpressionAttributeValues: { ":p": PARTITION.rated },
      ScanIndexForward: false,
      Limit: 300,
    });
    return (res.Items ?? [])
      .filter((i) => i.rating === 1 || i.rating === -1)
      .map((i) => ({
        id: i.id as string,
        subject: (i.subject as string | undefined) ?? "",
        rating: i.rating as Rating,
        ratedAt: i.ratedAt as string,
      }));
  }

  /** Embeddings by issue id, 100 keys per batch; issues not embedded yet are simply missing. */
  /**
   * Embeddings by issue id. With `keep`, vectors read stay with this instance (a warm Lambda
   * serves later calls from memory); an issue re-embedded by `pnpm enrich --force` shows its new
   * vector once the instance is recycled.
   */
  private async embeddings(ids: string[], keep = false): Promise<Map<string, Float32Array>> {
    const out = new Map<string, Float32Array>();
    const unique = [...new Set(ids)].filter((id) => {
      const v = keep ? this.vectorCache.get(id) : undefined;
      if (v) out.set(id, v);
      return !v;
    });
    for (let n = 0; n < unique.length; n += 100) {
      let keys: Record<string, unknown>[] | undefined = unique
        .slice(n, n + 100)
        .map((id) => embeddingKey(id));
      for (let attempt = 0; keys?.length && attempt < 5; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
        const res: BatchGetCommandOutput = await this.ddb.send(
          new BatchGetCommand({
            RequestItems: {
              [this.table]: {
                Keys: keys,
                ProjectionExpression: "#pk, #v",
                ExpressionAttributeNames: { "#pk": "pk", "#v": "vector" },
              },
            },
          }),
        );
        for (const item of res.Responses?.[this.table] ?? []) {
          const id = (item.pk as string).slice("ISSUE#".length);
          const vector = toVector(item.vector as Uint8Array);
          out.set(id, vector);
          if (keep) this.vectorCache.set(id, vector);
        }
        keys = res.UnprocessedKeys?.[this.table]?.Keys;
      }
    }
    return out;
  }

  // ---------- status ----------

  async status(): Promise<StatusResponse> {
    const [res, digestStats] = await Promise.all([
      this.ddb.send(new GetCommand({ TableName: this.table, Key: INGEST_STATE_KEY })),
      this.digestStats(),
    ]);
    return {
      digestStats,
      stage: this.stage,
      lastRunAt: res.Item?.lastRunAt as string | undefined,
      lastRunStats: res.Item?.lastRunStats as StatusResponse["lastRunStats"],
      lastError: (res.Item?.lastError as string | null | undefined) ?? null,
      lastEnrich: res.Item?.lastEnrich as StatusResponse["lastEnrich"],
      lastStories: res.Item?.lastStories as StatusResponse["lastStories"],
      lastShelves: res.Item?.lastShelves as StatusResponse["lastShelves"],
    };
  }

  private query(input: Omit<QueryCommandInput, "TableName">): Promise<QueryCommandOutput> {
    return this.ddb.send(new QueryCommand({ TableName: this.table, ...input }));
  }
}
