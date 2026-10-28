import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  BatchWriteCommand,
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
  EMBED_DIMENSIONS,
  embeddingKey,
  eventKey,
  followKey,
  FOLLOWING_PK,
  INDEX,
  INGEST_STATE_KEY,
  INTERESTS_KEY,
  NARRATIVE_KEY,
  openIndexAttributes,
  predictionKey,
  PARTITION,
  TOPICS_KEY,
  issueIndexAttributes,
  issueKey,
  retryOnConflict,
  s3Keys,
  senderIndexAttributes,
  senderItemKey,
  issueShelf,
  storyIndexAttributes,
  storyKey,
  storyRef,
  toVector,
  vectorBytes,
  type IngestStats,
  type ProcessedMessage,
  type StoredFollow,
} from "@library/core";
import type {
  EnrichStats,
  FollowPoint,
  Rating,
  Shelf,
  ShelfSetBy,
  ShelfStats,
  StoryShelfSetBy,
  StoryState,
  StoryStats,
  Topic,
} from "@library/core/types";
import { MODELS } from "./bedrock.js";
import type { Classification, EnrichCandidate } from "./enrich.js";
import type { RecentStory } from "./follow.js";
import { mapLimit } from "./ingest.js";
import type { SenderFields, SenderPlan, StoredIssue, StoredSender } from "./senders.js";
import type { StoredNarrative, StoryText } from "./narrative.js";
import type { NewPrediction } from "./predictions.js";
import type { ShelfCandidate } from "./shelves.js";
import { carriedOver, type NewStory, type OldStory, type StoredStory } from "./stories.js";

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

    await mapLimit(plan.rekeys, 10, async (r) => {
      await attempt(`re-key issue ${r.id}`, () =>
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
      );
      // Its stories (#15) carry the sender too.
      await attempt(`re-key stories of ${r.id}`, async () => {
        for (const Key of await this.storyKeys(r.id)) {
          await this.ddb.send(
            new UpdateCommand({
              TableName: this.table,
              Key,
              UpdateExpression: "SET senderId = :to",
              ExpressionAttributeValues: { ":to": r.toSenderId },
            }),
          );
        }
      });
    });

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

  async putIngestState(
    stats: IngestStats,
    enrichStats?: EnrichStats,
    storyStats?: StoryStats,
    shelfStats?: ShelfStats,
  ): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          ...INGEST_STATE_KEY,
          lastRunAt: new Date().toISOString(),
          lastRunStats: stats,
          lastError: stats.errors ? stats.errorSamples.join("; ") : null,
          lastEnrich: enrichStats,
          lastStories: storyStats,
          lastShelves: shelfStats,
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
              "id, senderId, publication, subject, receivedAt, summary, shelf, shelfSetBy, enrichedAt, embeddedAt, promo, storiedAt, storyAttempts, predictedAt, predictionAttempts, #st, autoArchived",
            ExpressionAttributeNames: { "#st": "state" },
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
            shelf: i.shelf as Shelf | undefined,
            enriched: Boolean(i.enrichedAt),
            embedded: Boolean(i.embeddedAt),
            promo: i.promo === true,
            storied: Boolean(i.storiedAt),
            storyAttempts: (i.storyAttempts as number | undefined) ?? 0,
            predicted: Boolean(i.predictedAt),
            predictionAttempts: (i.predictionAttempts as number | undefined) ?? 0,
            state: i.state as EnrichCandidate["state"],
            autoArchived: i.autoArchived !== undefined,
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

  /** The stored interests (names and texts only), to tell whether they need embedding again. */
  async getInterests(): Promise<{ name: string; text: string }[] | undefined> {
    const res = await this.ddb.send(new GetCommand({ TableName: this.table, Key: INTERESTS_KEY }));
    const list = res.Item?.interests as { name: string; text: string }[] | undefined;
    return list?.map(({ name, text }) => ({ name, text }));
  }

  /** The interest embeddings that seed ranking; the API reads them for the Summary page. */
  async putInterests(interests: { name: string; text: string; vector: number[] }[]): Promise<void> {
    for (const i of interests) {
      if (i.vector.length !== EMBED_DIMENSIONS) throw new Error("embedding has the wrong size");
    }
    await this.ddb.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          ...INTERESTS_KEY,
          interests: interests.map((i) => ({
            name: i.name,
            text: i.text,
            vector: new Uint8Array(new Float32Array(i.vector).buffer),
          })),
          model: MODELS.embed,
          at: new Date().toISOString(),
        },
      }),
    );
  }

  /** Sandip's per-sender settings: an "always" shelf, and the Must Read star. */
  async senderSettings(): Promise<
    Map<string, { shelf?: Shelf; mustRead: boolean; muted: boolean }>
  > {
    const settings = new Map<string, { shelf?: Shelf; mustRead: boolean; muted: boolean }>();
    let start: Record<string, unknown> | undefined;
    do {
      const res: QueryCommandOutput = await this.ddb.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: INDEX.list,
          KeyConditionExpression: "gsi1pk = :p",
          ExpressionAttributeValues: { ":p": PARTITION.senders },
          ProjectionExpression: "senderId, shelf, mustRead, muted",
          ExclusiveStartKey: start,
        }),
      );
      for (const s of res.Items ?? []) {
        const shelf = s.shelf === "news" || s.shelf === "learning" ? (s.shelf as Shelf) : undefined;
        settings.set(s.senderId as string, {
          shelf,
          mustRead: s.mustRead === true,
          muted: s.muted === true,
        });
      }
      start = res.LastEvaluatedKey;
    } while (start);
    return settings;
  }

  /**
   * Archive an unread issue by rule. Only once: an issue Sandip took back out of the archive is
   * never archived again by a rule, and a saved one (#43) is left alone. Returns whether it was
   * archived.
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
          ConditionExpression:
            "#st = :unread AND attribute_not_exists(autoArchived) AND attribute_not_exists(savedAt)",
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

  /**
   * Take a stored issue out of the library once it turns out not to be one (#50): account mail
   * Claude spotted, or mail a new noise rule catches. It becomes a filtered marker like the ones
   * ingest writes: out of every list and index, its stories deleted, its sender one issue lighter.
   * Never an issue Sandip rated or saved. Returns whether it was filtered.
   */
  async fileAsFiltered(id: string, reason: string, by: "claude" | "rule"): Promise<boolean> {
    const item = (
      await this.ddb.send(
        new GetCommand({ TableName: this.table, Key: issueKey(id), ConsistentRead: true }),
      )
    ).Item;
    if (!item || item.state === "filtered" || item.rating || item.savedAt) return false;
    const now = new Date().toISOString();
    const { remove } = issueIndexAttributes({
      id,
      senderId: item.senderId as string,
      receivedAt: item.receivedAt as string,
      state: "filtered",
    });
    try {
      await retryOnConflict(() =>
        this.ddb.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: this.table,
                  Key: issueKey(id),
                  UpdateExpression:
                    "SET #st = :filtered, filterReason = :why, stateChangedAt = :now " +
                    `REMOVE ${remove.join(", ")}`,
                  ConditionExpression:
                    "#st = :prev AND attribute_not_exists(rating) AND attribute_not_exists(savedAt)",
                  ExpressionAttributeNames: { "#st": "state" },
                  ExpressionAttributeValues: {
                    ":filtered": "filtered",
                    ":why": reason,
                    ":now": now,
                    ":prev": item.state,
                  },
                },
              },
              {
                Update: {
                  TableName: this.table,
                  Key: senderItemKey(item.senderId as string),
                  UpdateExpression: "ADD issueCount :minusOne",
                  ConditionExpression: "attribute_exists(pk)",
                  ExpressionAttributeValues: { ":minusOne": -1 },
                },
              },
            ],
          }),
        ),
      );
    } catch (err) {
      const e = err as { name?: string; CancellationReasons?: { Code?: string }[] };
      const failed =
        e.name === "TransactionCanceledException" &&
        e.CancellationReasons?.some((r) => r.Code === "ConditionalCheckFailed");
      if (failed) return false;
      throw err;
    }
    const stories = await this.storyKeys(id);
    await this.batchWrite([
      ...stories.map((Key) => ({ DeleteRequest: { Key } })),
      {
        PutRequest: {
          Item: {
            ...eventKey(id, now, randomUUID().slice(0, 8)),
            type: "state",
            value: "filtered",
            prev: item.state,
            by: `${by}:${reason}`,
          },
        },
      },
    ]);
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
  getText(id: string): Promise<string | undefined> {
    return this.readObject(s3Keys(id).text);
  }

  /** The issue's HTML (kept a year), or undefined once it has expired or was never written. */
  getHtml(id: string): Promise<string | undefined> {
    return this.readObject(s3Keys(id).html);
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

  /**
   * Store Claude's classification. An issue's shelf follows its stories (#81): one with none yet
   * starts on its newsletter's "always" setting, else News.
   */
  async putClassification(id: string, c: Classification, senderShelf?: Shelf): Promise<void> {
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.table,
        Key: issueKey(id),
        UpdateExpression:
          "SET #sum = :sum, #topic = :topic, #promo = :promo, #selling = :selling, " +
          "#at = :at, #model = :model, #shelf = if_not_exists(#shelf, :shelf)" +
          (senderShelf ? ", #by = if_not_exists(#by, :sender)" : ""),
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeNames: {
          "#sum": "summary",
          "#topic": "topic",
          "#promo": "promo",
          "#selling": "selling",
          "#at": "enrichedAt",
          "#model": "enrichModel",
          "#shelf": "shelf",
          ...(senderShelf ? { "#by": "shelfSetBy" } : {}),
        },
        ExpressionAttributeValues: {
          ":sum": c.summary,
          ":topic": c.topic,
          ":promo": c.promo,
          ":selling": c.selling,
          ":at": new Date().toISOString(),
          ":model": MODELS.classify,
          ":shelf": senderShelf ?? "news",
          ...(senderShelf ? { ":sender": "sender" } : {}),
        },
      }),
    );
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

  // ---------- story index (#15) ----------

  /** Stories received between two times (inclusive), oldest first, with their vectors. */
  async storiesBetween(fromIso: string, toIso: string): Promise<StoredStory[]> {
    const items = await this.queryStories(fromIso, toIso, "senderId, vector");
    return items.map((i) => ({
      key: storyRef(i.id as string, i.n as number),
      issueId: i.id as string,
      n: i.n as number,
      senderId: i.senderId as string,
      receivedAt: i.receivedAt as string,
      names: (i.names as string[] | undefined) ?? [],
      vector: toVector(i.vector as Uint8Array),
      eventId: i.eventId as string | undefined,
    }));
  }

  /** Stories received between two times (inclusive), oldest first, with what they say. */
  async storyTexts(fromIso: string, toIso: string): Promise<StoryText[]> {
    const items = await this.queryStories(fromIso, toIso, "headline, summary, shelf");
    return items.map((i) => ({
      key: storyRef(i.id as string, i.n as number),
      issueId: i.id as string,
      receivedAt: i.receivedAt as string,
      headline: i.headline as string,
      summary: i.summary as string,
      names: (i.names as string[] | undefined) ?? [],
      eventId: (i.eventId as string | undefined) ?? storyRef(i.id as string, i.n as number),
      ...(i.shelf ? { shelf: i.shelf as Shelf } : {}),
    }));
  }

  /** Stories received since `fromIso`, oldest first, with what Jev reads and their shelf fields. */
  async storyShelves(fromIso: string): Promise<ShelfCandidate[]> {
    const items = await this.queryStories(
      fromIso,
      "9999-12-31T23:59:59.999Z",
      "senderId, headline, summary, shelf, shelfSetBy, learning, #st, gsi2pk",
      { "#st": "state" },
    );
    return items.map((i) => ({
      issueId: i.id as string,
      n: i.n as number,
      senderId: i.senderId as string,
      receivedAt: i.receivedAt as string,
      headline: i.headline as string,
      summary: i.summary as string,
      shelf: i.shelf as Shelf | undefined,
      shelfSetBy: i.shelfSetBy as StoryShelfSetBy | undefined,
      learning: i.learning as number | undefined,
      state: i.state as StoryState | undefined,
      indexed: i.gsi2pk !== undefined,
    }));
  }

  /**
   * One story's shelf fields read from the table itself, not an index, for a write whose index
   * read turned out stale. Undefined when the story is gone.
   */
  async storyShelf(s: Pick<ShelfCandidate, "issueId" | "n">): Promise<ShelfCandidate | undefined> {
    const res = await this.ddb.send(
      new GetCommand({
        TableName: this.table,
        Key: storyKey(s.issueId, s.n),
        ProjectionExpression:
          "id, n, senderId, receivedAt, headline, summary, shelf, shelfSetBy, learning, #st, gsi2pk",
        ExpressionAttributeNames: { "#st": "state" },
        ConsistentRead: true,
      }),
    );
    const i = res.Item;
    if (!i) return undefined;
    return {
      issueId: i.id as string,
      n: i.n as number,
      senderId: i.senderId as string,
      receivedAt: i.receivedAt as string,
      headline: i.headline as string,
      summary: i.summary as string,
      shelf: i.shelf as Shelf | undefined,
      shelfSetBy: i.shelfSetBy as StoryShelfSetBy | undefined,
      learning: i.learning as number | undefined,
      state: i.state as StoryState | undefined,
      indexed: i.gsi2pk !== undefined,
    };
  }

  /**
   * Write a story's shelf and state, the `gsi2` attributes that follow from them, and Jev's answer
   * when there is one, provided its shelf's setter and its state are still those `s` was read
   * with. Returns false when they changed meanwhile (Sandip moved or read it) or it is gone.
   */
  async putStoryShelf(
    s: ShelfCandidate,
    next: { shelf?: Shelf; shelfSetBy?: StoryShelfSetBy; state?: StoryState },
    jev?: { learning: number; model: string },
  ): Promise<boolean> {
    const set: Record<string, unknown> = {};
    if (jev) Object.assign(set, { learning: jev.learning, shelfModel: jev.model });
    if (jev) set.shelvedAt = new Date().toISOString();
    if (next.shelf) Object.assign(set, { shelf: next.shelf, shelfSetBy: next.shelfSetBy });
    if (next.state) set.state = next.state;
    const index = storyIndexAttributes({
      issueId: s.issueId,
      n: s.n,
      receivedAt: s.receivedAt,
      shelf: next.shelf,
      state: next.state ?? s.state,
    });
    Object.assign(set, index.set);
    const names: Record<string, string> = { "#by": "shelfSetBy", "#st": "state" };
    const values: Record<string, unknown> = {};
    const assign = Object.entries(set).map(([k, v], i) => {
      names[`#a${i}`] = k;
      values[`:a${i}`] = v;
      return `#a${i} = :a${i}`;
    });
    const remove = index.remove.map((a, i) => {
      names[`#r${i}`] = a;
      return `#r${i}`;
    });
    const asRead = (attr: string, v: string | undefined, key: string) => {
      if (v === undefined) return `attribute_not_exists(${attr})`;
      values[key] = v;
      return `${attr} = ${key}`;
    };
    try {
      await this.ddb.send(
        new UpdateCommand({
          TableName: this.table,
          Key: storyKey(s.issueId, s.n),
          UpdateExpression: [
            assign.length ? `SET ${assign.join(", ")}` : "",
            remove.length ? `REMOVE ${remove.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join(" "),
          ConditionExpression: [
            "attribute_exists(pk)",
            asRead("#by", s.shelfSetBy, ":by0"),
            asRead("#st", s.state, ":st0"),
          ].join(" AND "),
          ExpressionAttributeNames: names,
          // DynamoDB rejects an empty map: a write that only removes, with nothing to compare.
          ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
        }),
      );
      return true;
    } catch (err) {
      if ((err as { name?: string }).name === "ConditionalCheckFailedException") return false;
      throw err;
    }
  }

  /**
   * Set each issue's shelf from its stories' (#81): Learning when every one is Learning. Reads
   * them fresh, so a move made meanwhile counts. Issues with no stories keep theirs. Returns how
   * many changed.
   */
  async deriveIssueShelves(ids: Iterable<string>): Promise<number> {
    let changed = 0;
    await mapLimit([...new Set(ids)], 8, async (id) => {
      const [meta, stories] = await Promise.all([
        this.ddb.send(
          new GetCommand({
            TableName: this.table,
            Key: issueKey(id),
            ProjectionExpression: "shelf, shelfSetBy, #st",
            ExpressionAttributeNames: { "#st": "state" },
            ConsistentRead: true,
          }),
        ),
        this.ddb.send(
          new QueryCommand({
            TableName: this.table,
            KeyConditionExpression: "pk = :pk AND begins_with(sk, :story)",
            ExpressionAttributeValues: { ":pk": issueKey(id).pk, ":story": "STORY#" },
            ProjectionExpression: "shelf",
            ConsistentRead: true,
          }),
        ),
      ]);
      const item = meta.Item;
      const shelf = issueShelf((stories.Items ?? []).map((i) => i.shelf as Shelf | undefined));
      if (!item || !shelf || item.state === "filtered") return;
      if (item.shelf === shelf && item.shelfSetBy === "stories") return;
      await this.ddb.send(
        new UpdateCommand({
          TableName: this.table,
          Key: issueKey(id),
          UpdateExpression: "SET shelf = :s, shelfSetBy = :by",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeValues: { ":s": shelf, ":by": "stories" },
        }),
      );
      changed++;
    });
    return changed;
  }

  private async queryStories(
    fromIso: string,
    toIso: string,
    extra: string,
    names: Record<string, string> = {},
  ) {
    const out: Record<string, unknown>[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const res: QueryCommandOutput = await this.ddb.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: INDEX.list,
          KeyConditionExpression: "gsi1pk = :p AND gsi1sk BETWEEN :from AND :to",
          ExpressionAttributeValues: {
            ":p": PARTITION.stories,
            ":from": fromIso,
            ":to": `${toIso}\uffff`,
          },
          ProjectionExpression: `id, n, receivedAt, #names, eventId, ${extra}`,
          ExpressionAttributeNames: { "#names": "names", ...names },
          ExclusiveStartKey: start,
        }),
      );
      out.push(...(res.Items ?? []));
      start = res.LastEvaluatedKey;
    } while (start);
    return out;
  }

  // ---------- follow a story (#22) ----------

  /** Every followed story, read consistently. */
  async follows(): Promise<StoredFollow[]> {
    const out: StoredFollow[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const res: QueryCommandOutput = await this.ddb.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: "pk = :p",
          ExpressionAttributeValues: { ":p": FOLLOWING_PK },
          ConsistentRead: true,
          ExclusiveStartKey: start,
        }),
      );
      for (const f of res.Items ?? []) {
        out.push({
          eventId: f.eventId as string,
          issueId: f.issueId as string,
          n: f.n as number,
          headline: f.headline as string,
          publication: f.publication as string,
          followedAt: f.followedAt as string,
          ...(typeof f.movedAt === "string" ? { movedAt: f.movedAt } : {}),
          seenAt: f.seenAt as string,
          points: f.points as FollowPoint[],
          checked: (f.checked as string[] | undefined) ?? [],
        });
      }
      start = res.LastEvaluatedKey;
    } while (start);
    return out;
  }

  /** Stories received since `fromIso`, oldest first, with what the check reads. */
  async recentStories(fromIso: string): Promise<RecentStory[]> {
    const items = await this.queryStories(
      fromIso,
      "9999-12-31T23:59:59.999Z",
      "senderId, headline, summary, vector",
    );
    return items.map((i) => {
      const key = storyRef(i.id as string, i.n as number);
      return {
        key,
        issueId: i.id as string,
        n: i.n as number,
        senderId: i.senderId as string,
        receivedAt: i.receivedAt as string,
        eventId: (i.eventId as string | undefined) ?? key,
        headline: i.headline as string,
        summary: (i.summary as string | undefined) ?? "",
        names: (i.names as string[] | undefined) ?? [],
        vector: i.vector instanceof Uint8Array ? toVector(i.vector) : new Float32Array(0),
      };
    });
  }

  /** The embeddings of some stories, by story ref ("<issueId>#<nn>"); missing ones left out. */
  async storyVectors(refs: string[]): Promise<Map<string, Float32Array>> {
    const found = new Map<string, Float32Array>();
    const keys = refs.map((r) => {
      const at = r.lastIndexOf("#");
      return storyKey(r.slice(0, at), Number(r.slice(at + 1)));
    });
    for (let i = 0; i < keys.length; i += 100) {
      let batch: Record<string, unknown>[] | undefined = keys.slice(i, i + 100);
      while (batch?.length) {
        const res: BatchGetCommandOutput = await this.ddb.send(
          new BatchGetCommand({
            RequestItems: {
              [this.table]: { Keys: batch, ProjectionExpression: "id, n, vector" },
            },
          }),
        );
        for (const s of res.Responses?.[this.table] ?? []) {
          if (s.vector instanceof Uint8Array) {
            found.set(storyRef(s.id as string, s.n as number), toVector(s.vector));
          }
        }
        batch = res.UnprocessedKeys?.[this.table]?.Keys;
      }
    }
    return found;
  }

  /** Each issue's newsletter and story count, for the check's points and prompt. */
  async issueBriefs(
    ids: string[],
  ): Promise<Map<string, { publication: string; storyCount: number }>> {
    const found = new Map<string, { publication: string; storyCount: number }>();
    for (let i = 0; i < ids.length; i += 100) {
      let batch: Record<string, unknown>[] | undefined = ids.slice(i, i + 100).map(issueKey);
      while (batch?.length) {
        const res: BatchGetCommandOutput = await this.ddb.send(
          new BatchGetCommand({
            RequestItems: {
              [this.table]: {
                Keys: batch,
                ProjectionExpression: "id, publication, storyCount",
              },
            },
          }),
        );
        for (const issue of res.Responses?.[this.table] ?? []) {
          found.set(issue.id as string, {
            publication: (issue.publication as string | undefined) ?? "",
            storyCount: (issue.storyCount as number | undefined) ?? 0,
          });
        }
        batch = res.UnprocessedKeys?.[this.table]?.Keys;
      }
    }
    return found;
  }

  /**
   * A follow's moves appended, its checked stories replaced and its movement time set, if it is
   * still followed. Sandip's `seenAt` is never touched, so new moves stay new.
   */
  async addMoves(
    eventId: string,
    moves: FollowPoint[],
    checked: string[],
    movedAt?: string,
  ): Promise<void> {
    const sets = ["checked = :c"];
    const values: Record<string, unknown> = { ":c": checked };
    if (moves.length) {
      sets.push("points = list_append(points, :p)");
      values[":p"] = moves;
    }
    if (movedAt) {
      sets.push("movedAt = :m");
      values[":m"] = movedAt;
    }
    try {
      await this.ddb.send(
        new UpdateCommand({
          TableName: this.table,
          Key: followKey(eventId),
          UpdateExpression: `SET ${sets.join(", ")}`,
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeValues: values,
        }),
      );
    } catch (err) {
      // Unfollowed while the check ran.
      if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
    }
  }

  // ---------- read history (#42) ----------

  /**
   * Index the `open` events logged before read history existed, so they show in it. Finds them by
   * a scan (the table is small) and returns how many it indexed. Safe to run again.
   */
  async indexOpens(): Promise<number> {
    let indexed = 0;
    let start: Record<string, unknown> | undefined;
    do {
      const res: ScanCommandOutput = await this.ddb.send(
        new ScanCommand({
          TableName: this.table,
          FilterExpression:
            "begins_with(sk, :evt) AND #type = :open AND attribute_not_exists(gsi1pk)",
          ExpressionAttributeNames: { "#type": "type" },
          ExpressionAttributeValues: { ":evt": "EVT#", ":open": "open" },
          ProjectionExpression: "pk, sk",
          ExclusiveStartKey: start,
        }),
      );
      await mapLimit(res.Items ?? [], 8, async (i) => {
        const pk = i.pk as string;
        const sk = i.sk as string;
        // EVT#<at>#<rand> on ISSUE#<id>
        const at = sk.split("#")[1]!;
        const idx = openIndexAttributes(pk.slice("ISSUE#".length), at);
        await this.ddb.send(
          new UpdateCommand({
            TableName: this.table,
            Key: { pk, sk },
            UpdateExpression: "SET gsi1pk = :p, gsi1sk = :s",
            ExpressionAttributeValues: { ":p": idx.gsi1pk, ":s": idx.gsi1sk },
          }),
        );
        indexed++;
      });
      start = res.LastEvaluatedKey;
    } while (start);
    return indexed;
  }

  // ---------- narrative (#18) ----------

  async getNarrative(): Promise<StoredNarrative | undefined> {
    const res = await this.ddb.send(new GetCommand({ TableName: this.table, Key: NARRATIVE_KEY }));
    if (!res.Item) return undefined;
    const { pk: _pk, sk: _sk, ...narrative } = res.Item;
    return narrative as StoredNarrative;
  }

  async putNarrative(narrative: StoredNarrative): Promise<void> {
    await this.ddb.send(
      new PutCommand({ TableName: this.table, Item: { ...NARRATIVE_KEY, ...narrative } }),
    );
  }

  /** Replace an issue's stories, then mark the issue as split. */
  async putStories(
    issue: { id: string; senderId: string; receivedAt: string },
    stories: NewStory[],
  ): Promise<void> {
    const now = new Date().toISOString();
    const puts = stories.map((s) => ({
      ...storyKey(issue.id, s.n),
      id: issue.id,
      n: s.n,
      senderId: issue.senderId,
      receivedAt: issue.receivedAt,
      headline: s.headline,
      summary: s.summary,
      names: s.names,
      link: s.link,
      eventId: s.eventId,
      vector: vectorBytes(s.vector),
      dims: s.vector.length,
      model: MODELS.classify,
      embedModel: MODELS.embed,
      at: now,
      gsi1pk: PARTITION.stories,
      gsi1sk: `${issue.receivedAt}#${storyRef(issue.id, s.n)}`,
    }));
    // A forced redo keeps Sandip's moves and read states (#98), and can come back with fewer
    // stories than before.
    const old = await this.oldStories(issue.id);
    for (const [k, p] of puts.entries()) {
      const carried = carriedOver(stories[k]!, old);
      Object.assign(
        p,
        carried,
        storyIndexAttributes({
          issueId: issue.id,
          n: p.n,
          receivedAt: issue.receivedAt,
          ...carried,
        }).set,
      );
    }
    const keep = new Set(puts.map((p) => p.sk));
    const stale = old.filter((k) => !keep.has(k.sk));
    await this.batchWrite([
      ...stale.map(({ pk, sk }) => ({ DeleteRequest: { Key: { pk, sk } } })),
      ...puts.map((Item) => ({ PutRequest: { Item } })),
    ]);
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.table,
        Key: issueKey(issue.id),
        UpdateExpression: "SET storiedAt = :at, storyCount = :n REMOVE storyError, storyAttempts",
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeValues: { ":at": now, ":n": stories.length },
      }),
    );
  }

  /** A failed split is counted, so an issue that keeps failing stops costing a call every run. */
  async putStoryError(id: string, message: string): Promise<void> {
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.table,
        Key: issueKey(id),
        UpdateExpression: "SET storyError = :e ADD storyAttempts :one",
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeValues: { ":e": message.slice(0, 300), ":one": 1 },
      }),
    );
  }

  /** An issue's stories as predictions name them (#24): number and headline. */
  async issueStories(id: string): Promise<{ n: number; headline: string }[]> {
    return (await this.oldStories(id))
      .map((s) => ({ n: Number(s.sk.slice("STORY#".length)), headline: s.headline }))
      .filter((s) => Number.isInteger(s.n))
      .sort((a, b) => a.n - b.n);
  }

  /** An issue's predictions (#24), then the issue marked as screened. */
  async putPredictions(
    issue: { id: string; senderId: string; publication: string; receivedAt: string },
    predictions: NewPrediction[],
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.batchWrite(
      predictions.map((p, k) => ({
        PutRequest: {
          Item: {
            ...predictionKey(issue.id, k + 1),
            id: `${issue.id}.${k + 1}`,
            issueId: issue.id,
            ...(p.n ? { n: p.n } : {}),
            senderId: issue.senderId,
            publication: issue.publication,
            saidAt: issue.receivedAt,
            text: p.text,
            who: p.who,
            own: p.own,
            quote: p.quote,
            by: p.by,
            due: p.due,
            status: "open",
            model: MODELS.classify,
            at: now,
          },
        },
      })),
    );
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.table,
        Key: issueKey(issue.id),
        UpdateExpression:
          "SET predictedAt = :at, predictionCount = :n REMOVE predictionError, predictionAttempts",
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeValues: { ":at": now, ":n": predictions.length },
      }),
    );
  }

  /** A failed screening is counted, so an issue that keeps failing stops costing a call. */
  async putPredictionError(id: string, message: string): Promise<void> {
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.table,
        Key: issueKey(id),
        UpdateExpression: "SET predictionError = :e ADD predictionAttempts :one",
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeValues: { ":e": message.slice(0, 300), ":one": 1 },
      }),
    );
  }

  /** New event ids after relinking. */
  async setEventIds(changes: { issueId: string; n: number; eventId: string }[]): Promise<void> {
    await mapLimit(changes, 8, async (c) => {
      await this.ddb.send(
        new UpdateCommand({
          TableName: this.table,
          Key: storyKey(c.issueId, c.n),
          UpdateExpression: "SET eventId = :e",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeValues: { ":e": c.eventId },
        }),
      );
    });
  }

  private async storyKeys(id: string): Promise<{ pk: string; sk: string }[]> {
    const res = await this.ddb.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :story)",
        ExpressionAttributeValues: { ":pk": issueKey(id).pk, ":story": "STORY#" },
        ProjectionExpression: "pk, sk",
      }),
    );
    return (res.Items ?? []).map((i) => ({ pk: i.pk as string, sk: i.sk as string }));
  }

  /** An issue's stored stories: their keys, and what a re-split carries over (#98). */
  private async oldStories(id: string): Promise<(OldStory & { pk: string; sk: string })[]> {
    const res = await this.ddb.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :story)",
        ExpressionAttributeValues: { ":pk": issueKey(id).pk, ":story": "STORY#" },
        ProjectionExpression: "pk, sk, link, headline, shelf, shelfSetBy, #st",
        ExpressionAttributeNames: { "#st": "state" },
        ConsistentRead: true,
      }),
    );
    return (res.Items ?? []).map((i) => ({
      pk: i.pk as string,
      sk: i.sk as string,
      link: i.link as string | undefined,
      headline: (i.headline as string | undefined) ?? "",
      shelf: i.shelf as Shelf | undefined,
      shelfSetBy: i.shelfSetBy as string | undefined,
      state: i.state as StoryState | undefined,
    }));
  }

  /** BatchWriteItem in chunks of 25, retrying what DynamoDB leaves unprocessed. */
  private async batchWrite(requests: Record<string, unknown>[]): Promise<void> {
    for (let i = 0; i < requests.length; i += 25) {
      let pending = requests.slice(i, i + 25);
      for (let attempt = 0; pending.length; attempt++) {
        if (attempt >= 8) throw new Error(`${pending.length} writes left unprocessed`);
        if (attempt) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
        const res = await this.ddb.send(
          new BatchWriteCommand({ RequestItems: { [this.table]: pending } }),
        );
        pending = (res.UnprocessedItems?.[this.table] ?? []) as Record<string, unknown>[];
      }
    }
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
