/** Integration: reprocess on the dev ingest Lambda restores derived content from raw MIME. */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { beforeAll, describe, expect, it } from "vitest";
import { s3Keys } from "@library/core";
import { devStack, seedDev, wipeDevTable, type DevStack } from "../../../scripts/dev-stack.js";
import type { ReprocessStats } from "../src/reprocess.js";

let stack: DevStack;
const s3 = new S3Client({ region: "us-east-1" });
const lambda = new LambdaClient({ region: "us-east-1" });

beforeAll(async () => {
  stack = await devStack();
  await wipeDevTable(stack);
  await seedDev(stack);
});

describe("reprocess on dev", () => {
  it("rebuilds HTML from raw MIME and leaves nothing else changed", async () => {
    const key = s3Keys("fx-bytebytego").html;
    await s3.send(
      new PutObjectCommand({ Bucket: stack.contentBucket, Key: key, Body: "<p>stale</p>" }),
    );

    const res = await lambda.send(
      new InvokeCommand({
        FunctionName: stack.ingestFunction,
        Payload: Buffer.from(JSON.stringify({ reprocess: { days: 3650 } })),
      }),
    );
    expect(res.FunctionError).toBeUndefined();
    const stats = JSON.parse(Buffer.from(res.Payload!).toString()) as ReprocessStats;
    expect(stats).toMatchObject({
      checked: 6,
      updated: 6,
      missingRaw: 0,
      nowFiltered: 0,
      errors: 0,
    });

    const html = await (
      await s3.send(new GetObjectCommand({ Bucket: stack.contentBucket, Key: key }))
    ).Body!.transformToString();
    expect(html).toContain("diagram.png");
    expect(html).not.toContain("stale");
  });
});
