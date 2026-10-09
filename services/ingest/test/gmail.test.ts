import { describe, expect, it } from "vitest";
import { Gmail } from "../src/gmail.js";

const creds = { clientId: "id", clientSecret: "secret", refreshToken: "refresh" };

/** Fake network: the token endpoint always works; Gmail calls return the queued responses. */
function fakeFetch(queue: { status: number; body: unknown }[]) {
  const gmailCalls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), {
        status: 200,
      });
    }
    gmailCalls.push(url);
    const next = queue.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { fetchFn, gmailCalls };
}

const rateLimited = (reason = "rateLimitExceeded") => ({
  status: 403,
  body: { error: { code: 403, message: "Rate limit exceeded", errors: [{ reason }] } },
});
const labels = { status: 200, body: { labels: [{ id: "Label_1", name: "Newsletters" }] } };

function client(queue: { status: number; body: unknown }[]) {
  const sleeps: number[] = [];
  const { fetchFn, gmailCalls } = fakeFetch(queue);
  const gmail = new Gmail(creds, {
    fetchFn,
    sleep: async (ms) => void sleeps.push(ms),
    now: () => 1_000_000, // frozen clock: pacing shows up as sleeps
  });
  return { gmail, gmailCalls, sleeps };
}

describe("Gmail client throttling", () => {
  it("retries a rate-limit 403 and succeeds", async () => {
    const { gmail, gmailCalls } = client([rateLimited(), labels]);
    expect(await gmail.listLabels()).toHaveLength(1);
    expect(gmailCalls).toHaveLength(2);
  });

  it("retries the userRateLimitExceeded reason, 429 and 5xx too", async () => {
    const { gmail, gmailCalls } = client([
      rateLimited("userRateLimitExceeded"),
      { status: 429, body: {} },
      { status: 503, body: {} },
      labels,
    ]);
    expect(await gmail.listLabels()).toHaveLength(1);
    expect(gmailCalls).toHaveLength(4);
  });

  it("does not retry a permission 403, and says why it failed", async () => {
    const { gmail, gmailCalls } = client([
      { status: 403, body: { error: { errors: [{ reason: "insufficientPermissions" }] } } },
    ]);
    await expect(gmail.listLabels()).rejects.toThrow("failed: 403 (insufficientPermissions)");
    expect(gmailCalls).toHaveLength(1);
  });

  it("gives up after 6 attempts", async () => {
    const { gmail, gmailCalls } = client(Array.from({ length: 6 }, () => rateLimited()));
    await expect(gmail.listLabels()).rejects.toThrow("failed: 403 (rateLimitExceeded)");
    expect(gmailCalls).toHaveLength(6);
  });

  it("backs off exponentially between retries", async () => {
    const { gmail, sleeps } = client([rateLimited(), rateLimited(), labels]);
    await gmail.listLabels();
    const backoffs = sleeps.filter((ms) => ms >= 1000);
    expect(backoffs).toHaveLength(2);
    expect(backoffs[0]).toBeGreaterThanOrEqual(1000);
    expect(backoffs[0]).toBeLessThan(1500);
    expect(backoffs[1]).toBeGreaterThanOrEqual(2000);
    expect(backoffs[1]).toBeLessThan(2500);
  });

  it("spaces parallel requests 100 ms apart", async () => {
    const { gmail, sleeps } = client([labels, labels, labels]);
    await Promise.all([gmail.listLabels(), gmail.listLabels(), gmail.listLabels()]);
    expect(sleeps).toEqual([100, 200]);
  });
});
