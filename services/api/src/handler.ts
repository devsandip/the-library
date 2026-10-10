import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { HttpError } from "./errors.js";
import type { Services } from "./port.js";
import { TitanEmbedder } from "./embed.js";
import { DynamoRepo } from "./repo.js";
import { API_PREFIX, route, type Request } from "./routes.js";
import { Search } from "./search.js";

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

export function createHandler(svc: Services) {
  return async (event: Event): Promise<APIGatewayProxyResultV2> => {
    const started = Date.now();
    const req = toRequest(event);
    let status = 500;
    try {
      const res = await route(svc, req);
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

const { TABLE_NAME, BUCKET_NAME, INGEST_FUNCTION, STAGE } = process.env;
const lambda = new LambdaClient({});

const repo = new DynamoRepo({
  table: TABLE_NAME!,
  bucket: BUCKET_NAME!,
  stage: STAGE ?? "unknown",
});

export const handler = createHandler({
  repo,
  // Kept between requests while the Lambda is warm: the corpus, and recent query embeddings.
  // Dev reads the corpus every time: integration tests rewrite it between searches.
  search: new Search(repo, new TitanEmbedder(), STAGE === "prod" ? {} : { ttlMs: 0 }),
  startIngest: async () => {
    await lambda.send(
      new InvokeCommand({
        FunctionName: INGEST_FUNCTION,
        InvocationType: "Event",
        Payload: Buffer.from("{}"),
      }),
    );
  },
});
