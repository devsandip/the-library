import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type BatchGetCommandOutput,
  type QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  INDEX,
  INGEST_STATE_KEY,
  PARTITION,
  issueIndexAttributes,
  issueKey,
  s3Keys,
  senderIndexAttributes,
  senderItemKey,
  type IngestStats,
  type ProcessedMessage,
} from "@library/core";

type Newsletter = Extract<ProcessedMessage, { kind: "newsletter" }>;
type Filtered = Extract<ProcessedMessage, { kind: "filtered" }>;

export class Store {
  private readonly ddb: DynamoDBDocumentClient;
  private readonly s3: S3Client;

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

    const index = issueIndexAttributes({
      id: p.id,
      senderId: p.senderId,
      receivedAt: p.receivedAt,
      state: "unread",
    });
    const senderIndex = senderIndexAttributes(p.senderId, p.publication);

    // Issue put and sender count move together; the condition makes a re-run a no-op.
    const stored = await this.ddb
      .send(
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
                  "SET senderId = :sid, senderKey = :skey, onKeepList = :keep, " +
                  "publication = if_not_exists(publication, :pub), " +
                  "gsi1pk = if_not_exists(gsi1pk, :g1pk), gsi1sk = if_not_exists(gsi1sk, :g1sk), " +
                  "muted = if_not_exists(muted, :false), " +
                  "up = if_not_exists(up, :zero), down = if_not_exists(down, :zero) " +
                  "ADD issueCount :one, addresses :addr",
                ExpressionAttributeValues: {
                  ":sid": p.senderId,
                  ":skey": p.senderKey,
                  ":keep": p.onKeepList,
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
    await this.ddb
      .send(
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
      )
      .catch(ignoreConditionFailure);
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
      "reprocessedAt = :now",
    ];
    const removes: string[] = [];
    const values: Record<string, unknown> = {
      ":snippet": p.snippet,
      ":words": p.wordCount,
      ":minutes": p.readMinutes,
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

  async putIngestState(stats: IngestStats): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          ...INGEST_STATE_KEY,
          lastRunAt: new Date().toISOString(),
          lastRunStats: stats,
          lastError: stats.errors ? stats.errorSamples.join("; ") : null,
        },
      }),
    );
  }

  private putObject(key: string, body: string | Buffer, contentType: string) {
    return this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }
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
