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

export class GmailAuthError extends Error {}

export class Gmail {
  private accessToken?: string;
  private expiresAt = 0;

  constructor(
    private readonly creds: GmailCredentials,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

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

  private async get<T>(path: string, attempt = 0): Promise<T> {
    const res = await this.fetchFn(`${API}${path}`, {
      headers: { authorization: `Bearer ${await this.token()}` },
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      return this.get<T>(path, attempt + 1);
    }
    if (!res.ok) throw new Error(`Gmail GET ${path.split("?")[0]} failed: ${res.status}`);
    return (await res.json()) as T;
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
