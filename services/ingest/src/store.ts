import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
  type BatchGetCommandOutput,
  type QueryCommandOutput,
  type ScanCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  embeddingKey,
  eventKey,
  INDEX,
  INGEST_STATE_KEY,
  PARTITION,
  TOPICS_KEY,
  issueIndexAttributes,
  issueKey,
  retryOnConflict,
  s3Keys,
  senderIndexAttributes,
  senderItemKey,
  type IngestStats,
  type ProcessedMessage,
} from "@library/core";
import type { EnrichStats, Rating, Shelf, ShelfSetBy, Topic } from "@library/core/types";
import { EMBED_DIMENSIONS, MODELS } from "./bedrock.js";
import type { Classification, EnrichCandidate } from "./enrich.js";
import { mapLimit } from "./ingest.js";
import type { SenderFields, SenderPlan, StoredIssue, StoredSender } from "./senders.js";

type Newsletter = Extract<ProcessedMessage, { kind: "newsletter" }>;
type Filtered = Extract<ProcessedMessage, { kind: "filtered" }>;

export class Store {
  private readonly ddb: DynamoDBDocumentClient;
  private readonly s3: S3Client;
  /** Tail of each sender's write queue (see serializeBySender). */
  private readonly senderQueues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly table: string,
    private readonly bucket: string,
    clients: { ddb?: DynamoDBClient; s3?: S3Client } = {},
  ) {
    this.ddb = DynamoDBDocumentClient.from(clients.ddb ?? new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.s3 = clients.s3 ?? new S3Client({});
  }

  /** Message IDs already stored, as a newsletter or as a filtered marker. */
  async existingIds(ids: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      let keys: Record<string, unknown>[] | undefined = ids.slice(i, i + 100).map(issueKey);
      while (keys?.length) {
        const res: BatchGetCommandOutput = await this.ddb.send(
          new BatchGetCommand({
            RequestItems: { [this.table]: { Keys: keys, ProjectionExpression: "pk" } },
          }),
        );
        for (const item of res.Responses?.[this.table] ?? []) {
          found.add(String(item.pk).slice("ISSUE#".length));
        }
        keys = res.UnprocessedKeys?.[this.table]?.Keys;
      }
    }
    return found;
  }

  /** Dedupe marker only: carries no index keys, so it is never listed. */
  async putFiltered(p: Filtered): Promise<void> {
    await this.ddb
      .send(
        new PutCommand({
          TableName: this.table,
          Item: {
            ...issueKey(p.id),
            id: p.id,
            state: "filtered",
            filterReason: p.reason,
            fromAddr: p.fromAddr,
            subject: p.subject,
            receivedAt: p.receivedAt,
            labelIds: p.labelIds,
          },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      )
      .catch(ignoreConditionFailure);
  }

  async putNewsletter(p: Newsletter, raw: Buffer): Promise<void> {
    const keys = s3Keys(p.id);
    await Promise.all([
      this.putObject(keys.raw, raw, "message/rfc822"),
      this.putObject(keys.html, p.html, "text/html; charset=utf-8"),
      this.putObject(keys.text, p.text, "text/plain; charset=utf-8"),
    ]);

    await this.serializeBySender(p.senderId, () => this.writeIssueAndSender(p, keys));
  }

  /**
   * Run `fn` after any earlier write for the same sender finishes. Every issue from a sender
   * updates that sender's item, and DynamoDB rejects writes that overlap on one item, so writes
   * for one sender go one at a time; different senders still write in parallel.
   */
  private serializeBySender<T>(senderId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.senderQueues.get(senderId) ?? Promise.resolve();
    const run = previous.then(fn);
    const tail = run.catch(() => undefined);
    this.senderQueues.set(senderId, tail);
    void tail.then(() => {
      if (this.senderQueues.get(senderId) === tail) this.senderQueues.delete(senderId);
    });
    return run;
  }

  private async writeIssueAndSender(p: Newsletter, keys: ReturnType<typeof s3Keys>): Promise<void> {
    const index = issueIndexAttributes({
      id: p.id,
      senderId: p.senderId,
      receivedAt: p.receivedAt,
      state: "unread",
    });
    const senderIndex = senderIndexAttributes(p.senderId, p.publication);

    // Issue put and sender count move together; the condition makes a re-run a no-op, which is
    // also what makes retrying a conflicting transaction safe. Conflicts can still come from
    // another process (the API updating the same sender), hence the retry.
    const stored = await retryOnConflict(() =>
      this.ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                ConditionExpression: "attribute_not_exists(pk)",
                Item: {
                  ...issueKey(p.id),
                  ...index.set,
                  id: p.id,
                  senderId: p.senderId,
                  publication: p.publication,
                  fromAddr: p.fromAddr,
                  fromName: p.fromName,
                  subject: p.subject,
                  receivedAt: p.receivedAt,
                  snippet: p.snippet,
                  viewOnlineUrl: p.viewOnlineUrl,
                  unsubscribeUrl: p.unsubscribeUrl,
                  wordCount: p.wordCount,
                  readMinutes: p.readMinutes,
                  state: "unread",
                  labelIds: p.labelIds,
                  s3Keys: keys,
                  ingestedAt: new Date().toISOString(),
                },
              },
            },
            {
              Update: {
                TableName: this.table,
                Key: senderItemKey(p.senderId),
                UpdateExpression:
                  "SET senderId = :sid, senderKey = :skey, " +
                  "publication = if_not_exists(publication, :pub), " +
                  "gsi1pk = if_not_exists(gsi1pk, :g1pk), gsi1sk = if_not_exists(gsi1sk, :g1sk), " +
                  "muted = if_not_exists(muted, :false), mustRead = if_not_exists(mustRead, :false), " +
                  "up = if_not_exists(up, :zero), down = if_not_exists(down, :zero) " +
                  "ADD issueCount :one, addresses :addr",
                ExpressionAttributeValues: {
                  ":sid": p.senderId,
                  ":skey": p.senderKey,
                  ":pub": p.publication,
                  ":g1pk": senderIndex.gsi1pk,
                  ":g1sk": senderIndex.gsi1sk,
                  ":false": false,
                  ":zero": 0,
                  ":one": 1,
                  ":addr": new Set([p.fromAddr]),
                },
              },
            },
          ],
        }),
      ),
    )
      .then(() => true)
      .catch((err) => (ignoreConditionFailure(err), false));

    if (stored) await this.touchSender(p);
  }

  /**
   * Latest-wins fields, only moved forward. Separate from the transaction because a failed
   * condition there would cancel the issue write; here it just means an older issue arrived late.
   */
  private async touchSender(p: Newsletter): Promise<void> {
    await retryOnConflict(() =>
      this.ddb.send(
        new UpdateCommand({
          TableName: this.table,
          Key: senderItemKey(p.senderId),
          ConditionExpression: "attribute_not_exists(lastSeenAt) OR lastSeenAt < :seen",
          UpdateExpression: p.unsubscribeUrl
            ? "SET lastSeenAt = :seen, unsubscribeUrl = :unsub"
            : "SET lastSeenAt = :seen",
          ExpressionAttributeValues: {
            ":seen": p.receivedAt,
            ...(p.unsubscribeUrl ? { ":unsub": p.unsubscribeUrl } : {}),
          },
        }),
      ),
    ).catch(ignoreConditionFailure);
  }

  /** Stored newsletters (inbox or archive) received since `sinceIso`: what reprocessing needs. */
  async recentIssues(sinceIso: string) {
    const out: { id: string; labelIds: string[]; receivedAt: string; snippet?: string }[] = [];
    for (const partition of [PARTITION.inbox, PARTITION.archive]) {
      let start: Record<string, unknown> | undefined;
      do {
        const res: QueryCommandOutput = await this.ddb.send(
          new QueryCommand({
            TableName: this.table,
            IndexName: INDEX.list,
            KeyConditionExpression: "gsi1pk = :p AND gsi1sk >= :since",
            ExpressionAttributeValues: { ":p": partition, ":since": sinceIso },
            ProjectionExpression: "id, labelIds, receivedAt, snippet",
            ExclusiveStartKey: start,
          }),
        );
        for (const i of res.Items ?? []) {
          out.push({
            id: i.id as string,
            labelIds: (i.labelIds as string[] | undefined) ?? [],
            receivedAt: i.receivedAt as string,
            snippet: i.snippet as string | undefined,
          });
        }
        start = res.LastEvaluatedKey;
      } while (start);
    }
    return out;
  }

  /** The original message, while it is still kept (30 days). */
  async getRaw(id: string): Promise<Buffer | undefined> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: s3Keys(id).raw }),
      );
      return Buffer.from((await res.Body?.transformToByteArray()) ?? []);
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return undefined;
      throw err;
    }
  }

  /** Replace an issue's derived content after a sanitizer change. Never touches state or rating. */
  async updateContent(p: Newsletter): Promise<void> {
    const keys = s3Keys(p.id);
    await Promise.all([
      this.putObject(keys.html, p.html, "text/html; charset=utf-8"),
      this.putObject(keys.text, p.text, "text/plain; charset=utf-8"),
    ]);
    const optional = { viewOnlineUrl: p.viewOnlineUrl, unsubscribeUrl: p.unsubscribeUrl };
    const sets = [
      "snippet = :snippet",
      "wordCount = :words",
      "readMinutes = :minutes",
      "fromName = :fromName",
      "reprocessedAt = :now",
    ];
    const removes: string[] = [];
    const values: Record<string, unknown> = {
      ":snippet": p.snippet,
      ":words": p.wordCount,
      ":minutes": p.readMinutes,
      ":fromName": p.fromName,
      ":now": new Date().toISOString(),
    };
    for (const [k, v] of Object.entries(optional)) {
      if (v === undefined) removes.push(k);
      else {
        sets.push(`${k} = :${k}`);
        values[`:${k}`] = v;
      }
    }
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.table,
        Key: issueKey(p.id),
        ConditionExpression: "attribute_exists(pk)",
        UpdateExpression: `SET ${sets.join(", ")}${removes.length ? ` REMOVE ${removes.join(", ")}` : ""}`,
        ExpressionAttributeValues: values,
      }),
    );
  }

  /** Every stored newsletter issue (sender fields only) and every sender item, read consistently. */
  async scanForSenderRebuild(): Promise<{ issues: StoredIssue[]; senders: StoredSender[] }> {
    const issues: StoredIssue[] = [];
    const senders: StoredSender[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const res: ScanCommandOutput = await this.ddb.send(
        new ScanCommand({
          TableName: this.table,
          ConsistentRead: true,
          FilterExpression: "sk = :meta",
          ProjectionExpression:
            "pk, id, #st, senderId, publication, fromAddr, fromName, receivedAt, rating, " +
            "unsubscribeUrl, senderKey, muted, mustRead, up, down, issueCount, addresses, lastSeenAt",
          ExpressionAttributeNames: { "#st": "state" },
          ExpressionAttributeValues: { ":meta": "META" },
          ExclusiveStartKey: start,
        }),
      );
      for (const i of res.Items ?? []) {
        const pk = String(i.pk);
        if (pk.startsWith("ISSUE#") && i.state !== "filtered" && i.senderId) {
          issues.push({
            id: i.id as string,
            senderId: i.senderId as string,
            publication: i.publication as string,
            fromAddr: i.fromAddr as string,
            fromName: i.fromName as string | undefined,
            receivedAt: i.receivedAt as string,
            rating: i.rating as Rating | undefined,
            unsubscribeUrl: i.unsubscribeUrl as string | undefined,
          });
        } else if (pk.startsWith("SENDER#")) {
          senders.push({
            senderId: pk.slice("SENDER#".length),
            senderKey: i.senderKey as string | undefined,
            publication: i.publication as string | undefined,
            muted: i.muted as boolean | undefined,
            mustRead: i.mustRead as boolean | undefined,
            up: i.up as number | undefined,
            down: i.down as number | undefined,
            issueCount: i.issueCount as number | undefined,
            addresses: [...((i.addresses as Set<string> | undefined) ?? [])],
            lastSeenAt: i.lastSeenAt as string | undefined,
            unsubscribeUrl: i.unsubscribeUrl as string | undefined,
          });
        }
      }
      start = res.LastEvaluatedKey;
    } while (start);
    return { issues, senders };
  }

  /**
   * Write a sender rebuild plan. New senders first (no issue ever points at a missing sender),
   * then issues, then recounts, then senders left empty. Recounts and deletes are conditional on
   * the counters as read, so a rating made meanwhile fails that write instead of being lost;
   * rerunning the rebuild picks it up. Returns one message per failed write.
   */
  async applySenderPlan(plan: SenderPlan): Promise<string[]> {
    const errors: string[] = [];
    const attempt = async (what: string, write: () => Promise<unknown>) => {
      try {
        await retryOnConflict(write);
      } catch (err) {
        errors.push(`${what}: ${(err as Error).name}: ${(err as Error).message}`);
      }
    };

    for (const c of plan.creates) {
      await attempt(`create ${c.publication}`, () =>
        this.ddb.send(
          new PutCommand({
            TableName: this.table,
            Item: {
              ...senderItemKey(c.senderId),
              ...senderIndexAttributes(c.senderId, c.publication),
              ...senderItemFields(c),
              muted: c.muted,
              mustRead: c.mustRead,
            },
            ConditionExpression: "attribute_not_exists(pk)",
          }),
        ),
      );
    }

    await mapLimit(plan.rekeys, 10, (r) =>
      attempt(`re-key issue ${r.id}`, () =>
        this.ddb.send(
          new UpdateCommand({
            TableName: this.table,
            Key: issueKey(r.id),
            UpdateExpression: "SET senderId = :to, publication = :pub, gsi3pk = :g3",
            ConditionExpression: "senderId = :from",
            ExpressionAttributeValues: {
              ":to": r.toSenderId,
              ":pub": r.publication,
              ":g3": `SENDER#${r.toSenderId}`,
              ":from": r.fromSenderId,
            },
          }),
        ),
      ),
    );

    for (const { next, current } of plan.updates) {
      const { unsubscribeUrl, ...fields } = {
        ...senderIndexAttributes(next.senderId, next.publication),
        ...senderItemFields(next),
      };
      const guard = countersAsRead(current);
      const names: Record<string, string> = { ...guard.names };
      const values: Record<string, unknown> = { ...guard.values };
      const set = unsubscribeUrl === undefined ? fields : { ...fields, unsubscribeUrl };
      const sets = Object.entries(set).map(([k, v], i) => {
        names[`#f${i}`] = k;
        values[`:f${i}`] = v;
        return `#f${i} = :f${i}`;
      });
      const remove = unsubscribeUrl === undefined ? " REMOVE unsubscribeUrl" : "";
      await attempt(`update ${next.publication}`, () =>
        this.ddb.send(
          new UpdateCommand({
            TableName: this.table,
            Key: senderItemKey(next.senderId),
            UpdateExpression: `SET ${sets.join(", ")}${remove}`,
            ConditionExpression: `attribute_exists(pk) AND ${guard.expr}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          }),
        ),
      );
    }

    for (const d of plan.deletes) {
      const guard = countersAsRead(d);
      await attempt(`delete ${d.publication ?? d.senderId}`, () =>
        this.ddb.send(
          new DeleteCommand({
            TableName: this.table,
            Key: senderItemKey(d.senderId),
            ConditionExpression: guard.expr,
            ExpressionAttributeNames: guard.names,
            ExpressionAttributeValues: Object.keys(guard.values).length ? guard.values : undefined,
          }),
        ),
      );
    }
    return errors;
  }

  async putIngestState(stats: IngestStats, enrichStats?: EnrichStats): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          ...INGEST_STATE_KEY,
          lastRunAt: new Date().toISOString(),
          lastRunStats: stats,
          lastError: stats.errors ? stats.errorSamples.join("; ") : null,
          lastEnrich: enrichStats,
        },
      }),
    );
  }

  // ---------- enrichment ----------

  /** Stored newsletters (inbox or archive) received since `sinceIso`, with their enrichment state. */
  async enrichCandidates(sinceIso: string): Promise<EnrichCandidate[]> {
    const out: EnrichCandidate[] = [];
    for (const partition of [PARTITION.inbox, PARTITION.archive]) {
      let start: Record<string, unknown> | undefined;
      do {
        const res: QueryCommandOutput = await this.ddb.send(
          new QueryCommand({
            TableName: this.table,
            IndexName: INDEX.list,
            KeyConditionExpression: "gsi1pk = :p AND gsi1sk >= :since",
            ExpressionAttributeValues: { ":p": partition, ":since": sinceIso },
            ProjectionExpression:
              "id, senderId, publication, subject, receivedAt, summary, shelfSetBy, enrichedAt, embeddedAt",
            ExclusiveStartKey: start,
          }),
        );
        for (const i of res.Items ?? []) {
          out.push({
            id: i.id as string,
            senderId: i.senderId as string,
            publication: i.publication as string,
            subject: i.subject as string,
            receivedAt: i.receivedAt as string,
            summary: i.summary as string | undefined,
            shelfSetBy: i.shelfSetBy as ShelfSetBy | undefined,
            enriched: Boolean(i.enrichedAt),
            embedded: Boolean(i.embeddedAt),
          });
        }
        start = res.LastEvaluatedKey;
      } while (start);
    }
    return out;
  }

  async getTopics(): Promise<Topic[] | undefined> {
    const res = await this.ddb.send(new GetCommand({ TableName: this.table, Key: TOPICS_KEY }));
    return res.Item?.topics as Topic[] | undefined;
  }

  async putTopics(topics: Topic[]): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.table,
        Item: { ...TOPICS_KEY, topics, model: MODELS.classify, at: new Date().toISOString() },
      }),
    );
  }

  /** Sandip's per-sender settings: an "always" shelf, and the Must Read star. */
  async senderSettings(): Promise<Map<string, { shelf?: Shelf; mustRead: boolean }>> {
    const settings = new Map<string, { shelf?: Shelf; mustRead: boolean }>();
    let start: Record<string, unknown> | undefined;
    do {
      const res: QueryCommandOutput = await this.ddb.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: INDEX.list,
          KeyConditionExpression: "gsi1pk = :p",
          ExpressionAttributeValues: { ":p": PARTITION.senders },
          ProjectionExpression: "senderId, shelf, mustRead",
          ExclusiveStartKey: start,
        }),
      );
      for (const s of res.Items ?? []) {
        const shelf = s.shelf === "news" || s.shelf === "learning" ? (s.shelf as Shelf) : undefined;
        settings.set(s.senderId as string, { shelf, mustRead: s.mustRead === true });
      }
      start = res.LastEvaluatedKey;
    } while (start);
    return settings;
  }

  /**
   * Archive an unread issue by rule. Only once: an issue Sandip took back out of the archive is
   * never archived again by a rule. Returns whether it was archived.
   */
  async autoArchive(id: string, reason: "promo" | "old-news"): Promise<boolean> {
    const now = new Date().toISOString();
    try {
      await this.ddb.send(
        new UpdateCommand({
          TableName: this.table,
          Key: issueKey(id),
          // The same index moves as issueIndexAttributes() for "archived": INBOX to ARCHIVE
          // (same sort key), and out of UNREAD.
          UpdateExpression:
            "SET #st = :archived, gsi1pk = :archive, stateChangedAt = :now, autoArchived = :why " +
            "REMOVE gsi2pk, gsi2sk",
          ConditionExpression: "#st = :unread AND attribute_not_exists(autoArchived)",
          ExpressionAttributeNames: { "#st": "state" },
          ExpressionAttributeValues: {
            ":archived": "archived",
            ":archive": PARTITION.archive,
            ":now": now,
            ":why": reason,
            ":unread": "unread",
          },
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name === "ConditionalCheckFailedException") return false;
      throw err;
    }
    await this.ddb.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          ...eventKey(id, now, randomUUID().slice(0, 8)),
          type: "state",
          value: "archived",
          prev: "unread",
          by: `rule:${reason}`,
        },
      }),
    );
    return true;
  }

  /**
   * Undo a rule's archive when the rule misfired: back to unread, and open to the rules again.
   * Returns whether it was restored.
   */
  async restoreFromRule(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    try {
      await this.ddb.send(
        new UpdateCommand({
          TableName: this.table,
          Key: issueKey(id),
          UpdateExpression:
            "SET #st = :unread, gsi1pk = :inbox, gsi2pk = :unreadIdx, gsi2sk = gsi1sk, " +
            "stateChangedAt = :now REMOVE autoArchived",
          ConditionExpression: "#st = :archived AND attribute_exists(autoArchived)",
          ExpressionAttributeNames: { "#st": "state" },
          ExpressionAttributeValues: {
            ":unread": "unread",
            ":inbox": PARTITION.inbox,
            ":unreadIdx": PARTITION.unread,
            ":now": now,
            ":archived": "archived",
          },
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name === "ConditionalCheckFailedException") return false;
      throw err;
    }
    await this.ddb.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          ...eventKey(id, now, randomUUID().slice(0, 8)),
          type: "state",
          value: "unread",
          prev: "archived",
          by: "rule-undo",
        },
      }),
    );
    return true;
  }

  /** Unread issues on the News shelf received before `cutoffIso`, not yet archived by a rule. */
  async unreadNewsBefore(cutoffIso: string): Promise<{ id: string; senderId: string }[]> {
    const out: { id: string; senderId: string }[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const res: QueryCommandOutput = await this.ddb.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: INDEX.unread,
          KeyConditionExpression: "gsi2pk = :p AND gsi2sk < :cutoff",
          FilterExpression: "shelf = :news AND attribute_not_exists(autoArchived)",
          ExpressionAttributeValues: {
            ":p": PARTITION.unread,
            ":cutoff": cutoffIso,
            ":news": "news",
          },
          ProjectionExpression: "id, senderId",
          ExclusiveStartKey: start,
        }),
      );
      for (const i of res.Items ?? []) {
        out.push({ id: i.id as string, senderId: i.senderId as string });
      }
      start = res.LastEvaluatedKey;
    } while (start);
    return out;
  }

  /** The issue's clean text (kept forever), or undefined if it was never written. */
  async getText(id: string): Promise<string | undefined> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: s3Keys(id).text }),
      );
      return await res.Body?.transformToString("utf-8");
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return undefined;
      throw err;
    }
  }

  /**
   * Store Claude's classification. The effective shelf follows the sender's "always" setting if
   * it has one, else Claude; an issue Sandip moved himself keeps his choice.
   */
  async putClassification(id: string, c: Classification, senderShelf?: Shelf): Promise<void> {
    const names = {
      "#sum": "summary",
      "#auto": "shelfAuto",
      "#topic": "topic",
      "#promo": "promo",
      "#selling": "selling",
      "#at": "enrichedAt",
      "#model": "enrichModel",
    };
    const values = {
      ":sum": c.summary,
      ":auto": c.shelf,
      ":topic": c.topic,
      ":promo": c.promo,
      ":selling": c.selling,
      ":at": new Date().toISOString(),
      ":model": MODELS.classify,
    };
    const base =
      "SET #sum = :sum, #auto = :auto, #topic = :topic, #promo = :promo, #selling = :selling, #at = :at, #model = :model";
    try {
      await this.ddb.send(
        new UpdateCommand({
          TableName: this.table,
          Key: issueKey(id),
          UpdateExpression: `${base}, #shelf = :shelf, #by = :by`,
          ConditionExpression:
            "attribute_exists(pk) AND (attribute_not_exists(#by) OR #by <> :sandip)",
          ExpressionAttributeNames: { ...names, "#shelf": "shelf", "#by": "shelfSetBy" },
          ExpressionAttributeValues: {
            ...values,
            ":shelf": senderShelf ?? c.shelf,
            ":by": senderShelf ? "sender" : "claude",
            ":sandip": "sandip",
          },
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
      // Sandip moved this issue himself: keep his shelf, store the rest.
      await this.ddb.send(
        new UpdateCommand({
          TableName: this.table,
          Key: issueKey(id),
          UpdateExpression: base,
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
    }
  }

  async putEmbedding(id: string, vector: number[]): Promise<void> {
    if (vector.length !== EMBED_DIMENSIONS) throw new Error("embedding has the wrong size");
    const now = new Date().toISOString();
    await this.ddb.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          ...embeddingKey(id),
          vector: new Uint8Array(new Float32Array(vector).buffer),
          dims: vector.length,
          model: MODELS.embed,
          at: now,
        },
      }),
    );
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.table,
        Key: issueKey(id),
        UpdateExpression: "SET embeddedAt = :at",
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeValues: { ":at": now },
      }),
    );
  }

  private putObject(key: string, body: string | Buffer, contentType: string) {
    return this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }
}

/** The attributes a rebuild sets on a sender item (flags such as muted and mustRead are left alone). */
function senderItemFields(s: SenderFields) {
  return {
    senderId: s.senderId,
    senderKey: s.senderKey,
    publication: s.publication,
    issueCount: s.issueCount,
    up: s.up,
    down: s.down,
    addresses: new Set(s.addresses),
    lastSeenAt: s.lastSeenAt,
    unsubscribeUrl: s.unsubscribeUrl,
  };
}

/** Condition: the sender's counters still hold the values the rebuild read. */
function countersAsRead(s: StoredSender) {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const parts = (["issueCount", "up", "down"] as const).map((attr) => {
    names[`#c_${attr}`] = attr;
    const read = s[attr];
    if (read === undefined) return `attribute_not_exists(#c_${attr})`;
    values[`:c_${attr}`] = read;
    return `#c_${attr} = :c_${attr}`;
  });
  return { expr: parts.join(" AND "), names, values };
}

/** Another run already stored this message. Not an error. */
function ignoreConditionFailure(err: unknown): void {
  const e = err as { name?: string; CancellationReasons?: { Code?: string }[] };
  if (e.name === "ConditionalCheckFailedException") return;
  if (
    e.name === "TransactionCanceledException" &&
    e.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed"
  ) {
    return;
  }
  throw err;
}
