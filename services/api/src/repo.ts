import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type QueryCommandInput,
  type QueryCommandOutput,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  eventKey,
  INDEX,
  INGEST_STATE_KEY,
  issueIndexAttributes,
  issueKey,
  PARTITION,
  retryOnConflict,
  s3Keys,
  senderItemKey,
} from "@library/core";
import type {
  IssueDetailResponse,
  IssueListItem,
  IssueListResponse,
  IssueState,
  Rating,
  ReaderState,
  SenderDetailResponse,
  SenderListItem,
  StatusResponse,
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
    topics: i.topics as string[] | undefined,
    scoreReason: i.scoreReason as string | undefined,
  };
}

export function toSender(s: Item): SenderListItem {
  return {
    senderId: s.senderId as string,
    senderKey: s.senderKey as string,
    publication: s.publication as string,
    muted: Boolean(s.muted),
    onKeepList: Boolean(s.onKeepList),
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

interface IndexQuery {
  index: string;
  pkAttr: string;
  skAttr: string;
  pkValue: string;
  filter?: { expr: string; names: Record<string, string>; values: Record<string, unknown> };
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

export class DynamoRepo implements RepoPort {
  private readonly ddb: DynamoDBDocumentClient;
  private readonly s3: S3Client;
  private readonly table: string;
  private readonly bucket: string;
  private readonly stage: string;

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

  private async viewQuery(view: View, senderId?: string): Promise<IndexQuery> {
    if (senderId) {
      return {
        index: INDEX.bySender,
        pkAttr: "gsi3pk",
        skAttr: "gsi3sk",
        pkValue: `SENDER#${senderId}`,
        filter: inFilter("state", "st", VIEW_STATES[view]),
      };
    }
    const q: IndexQuery =
      view === "unread"
        ? { index: INDEX.unread, pkAttr: "gsi2pk", skAttr: "gsi2sk", pkValue: PARTITION.unread }
        : {
            index: INDEX.list,
            pkAttr: "gsi1pk",
            skAttr: "gsi1sk",
            pkValue: view === "archived" ? PARTITION.archive : PARTITION.inbox,
          };
    if (view === "archived") return q; // explicit view: show everything archived
    const muted = (await this.listSenders()).filter((s) => s.muted).map((s) => s.senderId);
    // DynamoDB allows 100 values in IN; muting more than 100 senders is not a real scenario.
    return muted.length
      ? { ...q, filter: inFilter("senderId", "m", muted.slice(0, 100), true) }
      : q;
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
   * Newest first. Filters (muted senders, states) apply after DynamoDB's Limit, so keep reading
   * until the page is full. The next cursor is the last returned item's key, so trimming never
   * skips anything.
   */
  async listIssues(view: View, opts: ListOptions): Promise<IssueListResponse> {
    const q = await this.viewQuery(view, opts.senderId);
    let start = this.decodeCursor(opts.cursor, q);
    const items: Item[] = [];
    let exhausted = false;

    for (let round = 0; round < 10 && items.length <= opts.limit; round++) {
      const need = opts.limit + 1 - items.length;
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

    if (items.length > opts.limit) {
      const page = items.slice(0, opts.limit);
      return { items: page.map(toListItem), cursor: this.encodeCursor(page[page.length - 1]!, q) };
    }
    // Short page: either the index is exhausted, or the round cap hit; then resume where reading stopped.
    const cursor =
      exhausted || !start ? undefined : Buffer.from(JSON.stringify(start)).toString("base64url");
    return { items: items.map(toListItem), cursor };
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

  async setMuted(senderId: string, muted: boolean): Promise<SenderListItem> {
    try {
      const res = await this.ddb.send(
        new UpdateCommand({
          TableName: this.table,
          Key: senderItemKey(senderId),
          UpdateExpression: "SET muted = :m",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeValues: { ":m": muted },
          ReturnValues: "ALL_NEW",
        }),
      );
      return toSender(res.Attributes!);
    } catch (err) {
      if (isConditionFailure(err)) throw notFound("sender not found");
      throw err;
    }
  }

  // ---------- status ----------

  async status(): Promise<StatusResponse> {
    const res = await this.ddb.send(
      new GetCommand({ TableName: this.table, Key: INGEST_STATE_KEY }),
    );
    return {
      stage: this.stage,
      lastRunAt: res.Item?.lastRunAt as string | undefined,
      lastRunStats: res.Item?.lastRunStats as StatusResponse["lastRunStats"],
      lastError: (res.Item?.lastError as string | null | undefined) ?? null,
    };
  }

  private query(input: Omit<QueryCommandInput, "TableName">): Promise<QueryCommandOutput> {
    return this.ddb.send(new QueryCommand({ TableName: this.table, ...input }));
  }
}
