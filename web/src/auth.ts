/**
 * Cognito managed login with authorization code + PKCE (public client, no secret).
 * Access and ID tokens live in memory; the refresh token lives in localStorage so the phone and
 * laptop stay signed in for its 30-day life. See docs/architecture.md section 7.
 */
import { BASE, type AppConfig } from "./config.js";

const REFRESH_KEY = "thelibrary.refresh";
const PKCE_KEY = "thelibrary.pkce";
/** Refresh this long before expiry. */
const SKEW_MS = 60_000;

interface Tokens {
  accessToken: string;
  idToken: string;
  expiresAt: number;
}

interface PendingLogin {
  verifier: string;
  state: string;
  returnTo: string;
}

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomString(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export const redirectUri = () => `${location.origin}${BASE}/auth/callback`;
const logoutUri = () => `${location.origin}${BASE}/`;

function storage<T extends Storage>(get: () => T): T | undefined {
  try {
    return get();
  } catch {
    return undefined; // private mode or blocked storage: sign-in still works for the session
  }
}

export class Auth {
  private tokens?: Tokens;
  private inflight?: Promise<Tokens | undefined>;

  constructor(private readonly cfg: AppConfig) {}

  /** Leave for the Cognito sign-in page. Never resolves in practice. */
  async signIn(returnTo = location.pathname + location.search): Promise<never> {
    const pending: PendingLogin = { verifier: randomString(48), state: randomString(16), returnTo };
    storage(() => sessionStorage)?.setItem(PKCE_KEY, JSON.stringify(pending));
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.cfg.clientId,
      redirect_uri: redirectUri(),
      scope: "openid email",
      state: pending.state,
      code_challenge: await pkceChallenge(pending.verifier),
      code_challenge_method: "S256",
    });
    location.assign(`${this.cfg.cognitoDomain}/oauth2/authorize?${params}`);
    return new Promise<never>(() => undefined);
  }

  /** Handle /auth/callback. Returns the path to go back to. */
  async completeSignIn(url: URL): Promise<string> {
    const raw = storage(() => sessionStorage)?.getItem(PKCE_KEY);
    storage(() => sessionStorage)?.removeItem(PKCE_KEY);
    const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
    if (error) throw new Error(`Sign-in failed: ${error}`);
    const pending = raw ? (JSON.parse(raw) as PendingLogin) : undefined;
    const code = url.searchParams.get("code");
    if (!pending || !code || url.searchParams.get("state") !== pending.state) {
      throw new Error("Sign-in could not be verified. Please try again.");
    }
    await this.tokenRequest({
      grant_type: "authorization_code",
      client_id: this.cfg.clientId,
      code,
      redirect_uri: redirectUri(),
      code_verifier: pending.verifier,
    });
    return pending.returnTo.startsWith(BASE) ? pending.returnTo : `${BASE}/`;
  }

  /** A valid access token, refreshing if needed; undefined means a sign-in is required. */
  async accessToken(force = false): Promise<string | undefined> {
    if (!force && this.tokens && Date.now() < this.tokens.expiresAt - SKEW_MS) {
      return this.tokens.accessToken;
    }
    return (await this.refresh())?.accessToken;
  }

  /** Email from the ID token, for display only (not verified client-side). */
  email(): string | undefined {
    const payload = this.tokens?.idToken.split(".")[1];
    if (!payload) return undefined;
    try {
      const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
      return (JSON.parse(json) as { email?: string }).email;
    } catch {
      return undefined;
    }
  }

  async signOut(): Promise<never> {
    const refreshToken = storage(() => localStorage)?.getItem(REFRESH_KEY);
    storage(() => localStorage)?.removeItem(REFRESH_KEY);
    this.tokens = undefined;
    if (refreshToken) {
      // Best effort: revoke so a copied token stops working too.
      await fetch(`${this.cfg.cognitoDomain}/oauth2/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken, client_id: this.cfg.clientId }),
      }).catch(() => undefined);
    }
    const params = new URLSearchParams({ client_id: this.cfg.clientId, logout_uri: logoutUri() });
    location.assign(`${this.cfg.cognitoDomain}/logout?${params}`);
    return new Promise<never>(() => undefined);
  }

  /** One refresh at a time, shared by concurrent callers. */
  private refresh(): Promise<Tokens | undefined> {
    this.inflight ??= (async () => {
      try {
        const refreshToken = storage(() => localStorage)?.getItem(REFRESH_KEY);
        if (!refreshToken) return undefined;
        return await this.tokenRequest({
          grant_type: "refresh_token",
          client_id: this.cfg.clientId,
          refresh_token: refreshToken,
        });
      } catch {
        storage(() => localStorage)?.removeItem(REFRESH_KEY);
        this.tokens = undefined;
        return undefined;
      } finally {
        this.inflight = undefined;
      }
    })();
    return this.inflight;
  }

  private async tokenRequest(params: Record<string, string>): Promise<Tokens> {
    const res = await fetch(`${this.cfg.cognitoDomain}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      id_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !body.access_token || !body.id_token) {
      throw new Error(`token request failed: ${body.error ?? res.status}`);
    }
    // A refresh-token grant returns no new refresh token unless rotation is on; keep the old one.
    if (body.refresh_token) storage(() => localStorage)?.setItem(REFRESH_KEY, body.refresh_token);
    this.tokens = {
      accessToken: body.access_token,
      idToken: body.id_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return this.tokens;
  }
}
