import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { readerOf, type Reader } from "@library/core/reader";
import { Asks } from "./ask.js";
import { Audits } from "./audit.js";
import { HttpError, unauthorized } from "./errors.js";
import { Following } from "./following.js";
import { Highlights } from "./highlights.js";
import { Predictions } from "./predictions.js";
import { Tuneups } from "./tuneup.js";
import type { Services } from "./port.js";
import { BedrockClaude } from "./claude.js";
import { TitanEmbedder } from "./embed.js";
import { DynamoRepo } from "./repo.js";
import { API_PREFIX, route, type Request } from "./routes.js";
import { CorpusCache } from "./corpus.js";
import { Related } from "./related.js";
import { Search } from "./search.js";
import { Sources } from "./source.js";
import { Takes } from "./takes.js";
import { Timelines } from "./timeline.js";

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

const HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

function toRequest(event: Event): Request {
  const raw = event.rawPath;
  const path = raw.startsWith(API_PREFIX) ? raw.slice(API_PREFIX.length) || "/" : raw;
  const body =
    event.body === undefined
      ? undefined
      : event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body;
  return {
    method: event.requestContext.http.method,
    path,
    query: event.queryStringParameters ?? {},
    body,
  };
}

/**
 * The API's handler. Each request runs with the services of the reader its token names (#179);
 * a token that names no reader is refused before any route runs.
 */
export function createHandler(servicesFor: (reader: Reader) => Services) {
  return async (event: Event): Promise<APIGatewayProxyResultV2> => {
    const started = Date.now();
    const req = toRequest(event);
    let status = 500;
    try {
      const reader = readerOf(event.requestContext.authorizer?.jwt?.claims?.sub);
      if (!reader) throw unauthorized();
      const res = await route(servicesFor(reader), req);
      status = res.status;
      return {
        statusCode: res.status,
        headers: HEADERS,
        body: res.body === undefined ? "" : JSON.stringify(res.body),
      };
    } catch (err) {
      if (err instanceof HttpError) {
        status = err.status;
        return {
          statusCode: err.status,
          headers: HEADERS,
          body: JSON.stringify({ error: err.message }),
        };
      }
      console.error(
        JSON.stringify({
          level: "error",
          path: req.path,
          error: String(err),
          stack: (err as Error).stack,
        }),
      );
      return {
        statusCode: 500,
        headers: HEADERS,
        body: JSON.stringify({ error: "internal error" }),
      };
    } finally {
      console.log(
        JSON.stringify({
          level: "info",
          method: req.method,
          path: req.path,
          status,
          ms: Date.now() - started,
        }),
      );
    }
  };
}

const { TABLE_NAME, BUCKET_NAME, INGEST_FUNCTION, JOBS_FUNCTION, STAGE } = process.env;
const lambda = new LambdaClient({});

/** Starts a Lambda without waiting for it. */
async function invokeAsync(functionName: string, payload: unknown): Promise<void> {
  await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );
}

const ddb = new DynamoDBClient({});
const s3 = new S3Client({});
const claude = new BedrockClaude();

/** A reader's services, with the caches they keep while the Lambda is warm. */
function servicesOf(reader: Reader): Services {
  const repo = new DynamoRepo({
    table: TABLE_NAME!,
    bucket: BUCKET_NAME!,
    stage: STAGE ?? "unknown",
    reader,
    ddb,
    s3,
  });
  // Kept between requests: the corpus, and recent query embeddings. Dev reads the corpus every
  // time: integration tests rewrite it between calls.
  const corpus = new CorpusCache(repo, STAGE === "prod" ? {} : { ttlMs: 0 });
  return {
    repo,
    search: new Search(repo, new TitanEmbedder(), corpus),
    related: new Related(repo, corpus),
    timelines: new Timelines(repo, corpus, claude),
    takes: new Takes(repo, corpus, claude),
    sources: new Sources(repo, (job) => invokeAsync(JOBS_FUNCTION!, { ...job, reader: reader.id })),
    ask: new Asks(repo, corpus, new TitanEmbedder(), claude),
    following: new Following(repo),
    highlights: new Highlights(repo),
    predictions: new Predictions(repo),
    audit: new Audits(repo),
    tuneup: new Tuneups(repo),
    startIngest: () => invokeAsync(INGEST_FUNCTION!, {}),
  };
}

/** Readers whose services a warm Lambda keeps; past this, the one kept longest goes. */
const READERS_KEPT = 20;
const kept = new Map<string, Services>();

export const handler = createHandler((reader) => {
  let services = kept.get(reader.id);
  if (!services) {
    services = servicesOf(reader);
    kept.set(reader.id, services);
    if (kept.size > READERS_KEPT) kept.delete(kept.keys().next().value!);
  }
  return services;
});
