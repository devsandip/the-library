/**
 * The move (#199): every item still on today's keys copied to the owner's (milestone 13 of
 * docs/features/multi-reader.md). A copy has the owner's prefix on its partition key and index
 * partitions, and "reader" where a move of the owner's said "sandip" (#181). Run by
 * `pnpm move-to-reader`; the integration tests run it on dev.
 */
import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
  type DynamoDBDocumentClient,
  type ScanCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { keysFor, OWNER_KEY } from "@library/core";
import type { Reader } from "@library/core/reader";

type Item = Record<string, unknown>;

/** Items on today's keys: not under a reader's prefix, not the owner, not a reader's own. */
export function onTodaysKeys(i: Item): boolean {
  const pk = String(i.pk);
  if (pk.startsWith("R#") || pk.startsWith("READER#")) return false;
  return !(pk === OWNER_KEY.pk && i.sk === OWNER_KEY.sk);
}

/** What a stored "sandip" becomes (#181). */
const BY_READER: Record<string, string> = { sandip: "reader" };

/** An item as the owner's: the prefix on its partitions, "reader" for "sandip". */
export function ownersCopy(i: Item, owner: Reader): Item {
  const k = keysFor(owner.id);
  const copy: Item = { ...k.indexed(i), pk: `${k.prefix}${String(i.pk)}` };
  for (const attr of ["setBy", "shelfSetBy"]) {
    const v = copy[attr];
    if (typeof v === "string" && BY_READER[v]) copy[attr] = BY_READER[v];
  }
  return copy;
}

/** What an item is, for the counts: the start of its partition key and the start of its sort key. */
export function kindOf(i: Item): string {
  const pk = String(i.pk).split("#")[0]!;
  const sk = String(i.sk).split("#")[0]!;
  return pk === "ISSUE" ? `ISSUE ${sk}` : pk;
}

export interface MoveReport {
  /** Items on today's keys, by kind. */
  found: Record<string, number>;
  /** Copied now. */
  copied: number;
  /** Already copied (left alone: the copy may be newer). */
  already: number;
  /** Without a copy, after the run. */
  missing: number;
  /** Today's keys deleted (`delete`). */
  deleted: number;
}

async function* scanTodays(ddb: DynamoDBDocumentClient, table: string): AsyncGenerator<Item[]> {
  let start: Item | undefined;
  do {
    const page: ScanCommandOutput = await ddb.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: "NOT begins_with(pk, :r) AND NOT begins_with(pk, :reader)",
        ExpressionAttributeValues: { ":r": "R#", ":reader": "READER#" },
        ExclusiveStartKey: start,
      }),
    );
    yield (page.Items ?? []).filter(onTodaysKeys);
    start = page.LastEvaluatedKey;
  } while (start);
}

/**
 * Counts (`count`), copies (`apply`), checks, or deletes today's keys once every one has its
 * copy (`delete`). A copy never overwrites one already there, so `apply` can run again.
 */
export async function move(
  ddb: DynamoDBDocumentClient,
  table: string,
  owner: Reader,
  mode: "count" | "apply" | "check" | "delete",
): Promise<MoveReport> {
  const report: MoveReport = { found: {}, copied: 0, already: 0, missing: 0, deleted: 0 };
  const old: Item[] = [];
  for await (const page of scanTodays(ddb, table)) {
    for (const i of page) {
      report.found[kindOf(i)] = (report.found[kindOf(i)] ?? 0) + 1;
      const copy = ownersCopy(i, owner);
      if (mode === "apply") {
        try {
          await ddb.send(
            new PutCommand({
              TableName: table,
              Item: copy,
              ConditionExpression: "attribute_not_exists(pk)",
            }),
          );
          report.copied++;
        } catch (err) {
          if ((err as Error).name !== "ConditionalCheckFailedException") throw err;
          report.already++;
        }
      } else if (mode !== "count") {
        const got = await ddb.send(
          new GetCommand({
            TableName: table,
            Key: { pk: copy.pk, sk: copy.sk },
            ProjectionExpression: "pk",
          }),
        );
        if (got.Item) old.push({ pk: i.pk, sk: i.sk });
        else report.missing++;
      }
    }
  }
  if (mode === "delete") {
    if (report.missing)
      throw new Error(`${report.missing} items have no copy yet: run --apply first`);
    for (let n = 0; n < old.length; n += 25) {
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: {
            [table]: old.slice(n, n + 25).map((Key) => ({ DeleteRequest: { Key } })),
          },
        }),
      );
      report.deleted += Math.min(25, old.length - n);
    }
  }
  return report;
}
