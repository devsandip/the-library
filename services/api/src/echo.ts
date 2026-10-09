/**
 * TEMPORARY (build plan R2). Echoes what reached the Lambda so the hosting spike can prove the
 * Amplify -> CloudFront -> HTTP API chain preserves methods, paths, query strings, bodies and
 * auth headers. Header values are returned only as short hashes. Removed in R6.
 */
import { createHash, randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

const hash = (v: string | undefined) =>
  v === undefined ? null : createHash("sha256").update(v).digest("hex").slice(0, 12);

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body
    : "";
  const bytes = Math.min(Number(event.queryStringParameters?.bytes) || 0, 5_000_000);

  const payload = {
    nonce: randomUUID(),
    at: new Date().toISOString(),
    method: event.requestContext.http.method,
    rawPath: event.rawPath,
    rawQueryString: event.rawQueryString,
    query: event.queryStringParameters ?? {},
    contentType: event.headers["content-type"] ?? null,
    isBase64Encoded: event.isBase64Encoded,
    bodyLength: body.length,
    bodyHash: hash(body || undefined),
    authorizationHash: hash(event.headers["authorization"]),
    customAuthHash: hash(event.headers["x-library-auth"]),
    headerNames: Object.keys(event.headers).sort(),
    filler: bytes ? "x".repeat(bytes) : undefined,
  };

  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(payload),
  };
}
