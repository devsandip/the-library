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
  issueIndexAttributes,
  issueKey,
  PARTITION,
  pickTop,
  rank,
  readerDay,
  recentDays,
  relatedIssues,
  retryOnConflict,
  s3Keys,
  senderItemKey,
  TOPICS_KEY,
  toVector,
  type InterestVector,
  type RelatedMatch,
} from "@library/core";
import type {
  DigestStats,
  IssueDetailResponse,
  IssueListItem,
  IssueListResponse,
  IssueState,
  Narrative,
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
  SummaryResponse,
  Topic,
  UnreadCount,
  UnreadCountsResponse,
  View,
} from "@library/core/types";
import { badRequest, conflict, notFound } from "./errors.js";
import type { ListOptions, RepoPort } from "./port.js";

type Item = Record<string, unknown>;

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

const VIEW_STATES: Record<View, IssueState[]> = {
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

export class DynamoRepo implements RepoPort {
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
   * One view as one index stream. Muted senders are hidden everywhere but Archived, unless they
   * are picked: one sender reads its own index, several filter the view's index.
   */
  private viewQuery(view: View, muted: string[], senderIds?: string[], extra?: Filter): IndexQuery {
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
    const item = await this.mustGetIssue(id);
    const keys = s3Keys(id);
    // Sanitized HTML expires after a year; the clean text is kept forever.
    let html = await this.readObject(keys.html);
    if (html === undefined) {
      const text =
        (await this.readObject(keys.text)) ?? "This issue's content is no longer stored.";
      const escaped = text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      html = `<pre style="white-space:pre-wrap;font-family:inherit">${escaped}</pre>`;
    }
    return {
      ...toListItem(item),
      fromAddr: item.fromAddr as string,
      unsubscribeUrl: item.unsubscribeUrl as string | undefined,
      html,
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
    const idx = issueIndexAttributes({
      id,
      senderId: item.senderId as string,
      receivedAt: item.receivedAt as string,
      state,
      rating: item.rating as Rating | undefined,
      ratedAt: item.ratedAt as string | undefined,
    });
    const u = updateExpression({ state, stateChangedAt: now, ...idx.set }, idx.remove);
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
    ]);
    return toListItem({ ...item, state });
  }

  async setShelf(id: string, shelf: Shelf): Promise<IssueListItem> {
    const item = await this.mustGetIssue(id);
    if (item.shelf === shelf && item.shelfSetBy === "sandip") return toListItem(item);
    const now = new Date().toISOString();
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
      this.event(id, now, { type: "shelf", value: shelf, prev: (item.shelf as string) ?? null }),
    ]);
    return toListItem({ ...item, shelf, shelfSetBy: "sandip" });
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
    await this.mustGetIssue(id);
    const now = new Date().toISOString();
    await this.ddb.send(new PutCommand(this.event(id, now, { type: "open" }).Put));
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
   * Apply a sender's "always" shelf to its issues, or hand them back to Claude when it is cleared.
   * Issues Sandip moved himself keep his choice.
   */
  private async reshelveSender(senderId: string, shelf: Shelf | null): Promise<void> {
    const issues: Item[] = [];
    let start: Item | undefined;
    do {
      const res: QueryCommandOutput = await this.query({
        IndexName: INDEX.bySender,
        KeyConditionExpression: "gsi3pk = :p",
        ExpressionAttributeValues: { ":p": `SENDER#${senderId}` },
        ProjectionExpression: "id, shelfAuto, shelfSetBy",
        ExclusiveStartKey: start,
      });
      issues.push(...(res.Items ?? []));
      start = res.LastEvaluatedKey;
    } while (start);

    const names = { "#sh": "shelf", "#by": "shelfSetBy" };
    const update = (i: Item) => {
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
    const writes = issues
      .map((i) => ({ id: i.id as string, u: update(i) }))
      .filter((w) => w.u !== undefined);
    for (let n = 0; n < writes.length; n += 10) {
      await Promise.all(
        writes.slice(n, n + 10).map(({ id, u }) =>
          this.ddb
            .send(
              new UpdateCommand({
                TableName: this.table,
                Key: issueKey(id),
                ExpressionAttributeNames: names,
                ...u!,
              }),
            )
            .catch((err: unknown) => {
              // Sandip moved it in the meantime: his choice stands.
              if (!isConditionFailure(err)) throw err;
            }),
        ),
      );
    }
  }

  async listTopics(): Promise<Topic[]> {
    const res = await this.ddb.send(new GetCommand({ TableName: this.table, Key: TOPICS_KEY }));
    return (res.Item?.topics as Topic[] | undefined) ?? [];
  }

  // ---------- counts and summary ----------

  /** Unread issues counted by sender, shelf and topic. Muted senders are included. */
  async unreadCounts(): Promise<UnreadCountsResponse> {
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
    return { counts: [...tally.values()] };
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
      digest,
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
   * Issues related to `id` (#20): nearest neighbours over every stored issue's embedding, at read
   * time. Promos and muted newsletters stay out. Fine to a few thousand issues; past that, keep
   * the vectors packed in one object instead of reading them item by item.
   */
  async related(id: string): Promise<RelatedResponse> {
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
  private async todaysDigest(day: string, top: string[]): Promise<string[]> {
    const logged = async () =>
      (await this.ddb.send(new GetCommand({ TableName: this.table, Key: digestKey(day) }))).Item;
    const found = await logged();
    if (found) return (found.ids as string[] | undefined) ?? [];
    if (!top.length) return [];
    try {
      await this.ddb.send(
        new PutCommand({
          TableName: this.table,
          Item: { ...digestKey(day), ids: top, at: new Date().toISOString() },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return top;
    } catch (err) {
      // Another request logged today's first.
      if (!isConditionFailure(err)) throw err;
      return ((await logged())?.ids as string[] | undefined) ?? top;
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
   * how many are rated Relevant and Irrelevant by now. The PRD's aim: 3 of every 5 Relevant.
   */
  private async digestStats(now = Date.now()): Promise<DigestStats> {
    const digests = await this.batchGet(recentDays(now, DIGEST_DAYS).map(digestKey), ["ids"]);
    const ids = [...new Set(digests.flatMap((d) => (d.ids as string[] | undefined) ?? []))];
    const rated = await this.batchGet(ids.map(issueKey), ["rating"]);
    return {
      days: digests.length,
      shown: ids.length,
      relevant: rated.filter((i) => i.rating === 1).length,
      irrelevant: rated.filter((i) => i.rating === -1).length,
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
    };
  }

  private query(input: Omit<QueryCommandInput, "TableName">): Promise<QueryCommandOutput> {
    return this.ddb.send(new QueryCommand({ TableName: this.table, ...input }));
  }
}
