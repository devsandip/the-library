/** Minimal Gmail REST client. Plain fetch keeps the bundle small (googleapis is ~100 MB). */

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GmailRawMessage {
  id: string;
  labelIds: string[];
  snippet?: string;
  internalDate?: string;
  raw: Buffer;
}

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Gmail allows 250 quota units per user per second and a message get costs 5, so an unpaced
 * burst of parallel fetches (a backfill) hits its rate limit, which Gmail reports as 403 or 429.
 * The first prod backfill still drew rateLimitExceeded at 20 requests/s, so start at most one
 * request every 100 ms (10/s). A scheduled run fetches a handful of messages, so speed is moot.
 */
const MIN_INTERVAL_MS = 100;
const MAX_ATTEMPTS = 6;
const RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "RATE_LIMIT_EXCEEDED",
  "RESOURCE_EXHAUSTED",
]);

export class GmailAuthError extends Error {}

export interface GmailOptions {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
}

interface GoogleError {
  error?: {
    status?: string;
    message?: string;
    errors?: { reason?: string }[];
    details?: { reason?: string }[];
  };
}

/** Google's reason for a failed call, from whichever field this API version filled in. */
function errorReasons(body: GoogleError): string[] {
  const e = body.error;
  if (!e) return [];
  return [
    ...(e.errors ?? []).map((x) => x.reason ?? ""),
    ...(e.details ?? []).map((x) => x.reason ?? ""),
    e.status ?? "",
  ].filter(Boolean);
}

export class Gmail {
  private accessToken?: string;
  private expiresAt = 0;
  private nextSlot = 0;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly minIntervalMs: number;

  constructor(
    private readonly creds: GmailCredentials,
    opts: GmailOptions = {},
  ) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.minIntervalMs = opts.minIntervalMs ?? MIN_INTERVAL_MS;
  }

  /** Reserve the next request slot. Synchronous reservation, so parallel callers queue up. */
  private async pace(): Promise<void> {
    const now = this.now();
    const start = Math.max(now, this.nextSlot);
    this.nextSlot = start + this.minIntervalMs;
    if (start > now) await this.sleep(start - now);
  }

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    const res = await this.fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.creds.clientId,
        client_secret: this.creds.clientSecret,
        refresh_token: this.creds.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const body = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !body.access_token) {
      // invalid_grant = revoked or expired refresh token. Rerun `pnpm gmail:auth`.
      throw new GmailAuthError(`Gmail token refresh failed: ${body.error ?? res.status}`);
    }
    this.accessToken = body.access_token;
    this.expiresAt = Date.now() + (body.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  /** GET with pacing, and exponential backoff on throttling (429, rate-limit 403s) and 5xx. */
  private async get<T>(path: string): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      await this.pace();
      const res = await this.fetchFn(`${API}${path}`, {
        headers: { authorization: `Bearer ${await this.token()}` },
      });
      if (res.ok) return (await res.json()) as T;

      const reasons = errorReasons((await res.json().catch(() => ({}))) as GoogleError);
      const throttled =
        res.status === 429 ||
        (res.status === 403 && reasons.some((r) => RATE_LIMIT_REASONS.has(r)));
      if ((!throttled && res.status < 500) || attempt >= MAX_ATTEMPTS) {
        const why = reasons.length ? ` (${reasons.join(", ")})` : "";
        throw new Error(`Gmail GET ${path.split("?")[0]} failed: ${res.status}${why}`);
      }
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 16_000);
      await this.sleep(backoff + Math.floor(Math.random() * 500));
    }
  }

  async listMessageIds(query: string, max = 2000): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q: query, maxResults: "500" });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await this.get<{ messages?: { id: string }[]; nextPageToken?: string }>(
        `/messages?${params}`,
      );
      ids.push(...(page.messages ?? []).map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < max);
    return ids.slice(0, max);
  }

  async getRaw(id: string): Promise<GmailRawMessage> {
    const m = await this.get<{
      id: string;
      labelIds?: string[];
      snippet?: string;
      internalDate?: string;
      raw: string;
    }>(`/messages/${id}?format=raw`);
    return {
      id: m.id,
      labelIds: m.labelIds ?? [],
      snippet: m.snippet,
      internalDate: m.internalDate,
      raw: Buffer.from(m.raw, "base64url"),
    };
  }

  async listLabels(): Promise<{ id: string; name: string }[]> {
    const res = await this.get<{ labels: { id: string; name: string }[] }>("/labels");
    return res.labels;
  }
}
