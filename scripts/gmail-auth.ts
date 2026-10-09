/**
 * One-time Gmail connection (docs/architecture.md section 3, README "Connect Gmail").
 *
 *   AWS_PROFILE=admin pnpm gmail:auth --credentials ~/Downloads/client_secret_XXXX.json
 *
 * Opens Google's consent page, catches the redirect on 127.0.0.1, exchanges the code (PKCE),
 * checks the token can read the newsletter labels, and stores {clientId, clientSecret,
 * refreshToken} in SSM as a SecureString. Nothing is printed or written to disk.
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import type { AddressInfo } from "node:net";
import { PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { NEWSLETTER_LABEL_IDS } from "@library/core";
import { Gmail } from "../services/ingest/src/gmail.js";

const STAGE = "prod";
const PARAM = `/thelibrary/${STAGE}/gmail/oauth`;
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const credentialsPath = arg("--credentials")?.replace(/^~(?=$|\/)/, homedir());
if (!credentialsPath) {
  console.error("Usage: pnpm gmail:auth --credentials /path/to/client_secret_XXXX.json");
  console.error("Download it from Google Cloud > Credentials > your Desktop OAuth client.");
  process.exit(1);
}
const file = JSON.parse(readFileSync(credentialsPath, "utf8")) as {
  installed?: { client_id: string; client_secret: string };
};
if (!file.installed) {
  console.error("That file is not a Desktop app OAuth client (no 'installed' section).");
  process.exit(1);
}
const { client_id: clientId, client_secret: clientSecret } = file.installed;

const b64url = (b: Buffer) => b.toString("base64url");
const verifier = b64url(randomBytes(48));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const state = b64url(randomBytes(16));

let redirectUri = "";
const code = await new Promise<string>((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/") {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get("error");
    const got = url.searchParams.get("code");
    const ok = !error && got && url.searchParams.get("state") === state;
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(
      ok
        ? "The Library is connected to Gmail. You can close this tab."
        : `Failed: ${error ?? "state mismatch"}`,
    );
    server.close();
    if (ok) resolve(got);
    else reject(new Error(`Google sign-in failed: ${error ?? "state mismatch"}`));
  });
  server.listen(0, "127.0.0.1", () => {
    redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent", // always return a refresh token
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    console.log("Opening Google sign-in in your browser. If it does not open, visit:\n");
    console.log(url, "\n");
    execFile("open", [url], () => undefined);
  });
});

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  }),
});
const token = (await tokenRes.json()) as { refresh_token?: string; scope?: string; error?: string };
if (!tokenRes.ok || !token.refresh_token) {
  throw new Error(`Token exchange failed: ${token.error ?? tokenRes.status} (no refresh token)`);
}
if (!token.scope?.includes(SCOPE)) throw new Error("Gmail read access was not granted.");

// Prove the token works and sees the newsletter labels before storing it.
const gmail = new Gmail({ clientId, clientSecret, refreshToken: token.refresh_token });
const labels = await gmail.listLabels();
const missing = NEWSLETTER_LABEL_IDS.filter((id) => !labels.some((l) => l.id === id));
if (missing.length)
  console.warn(`Warning: labels not found in this mailbox: ${missing.join(", ")}`);

await new SSMClient({ region: "us-east-1" }).send(
  new PutParameterCommand({
    Name: PARAM,
    Type: "SecureString",
    Overwrite: true,
    Description: "The Library: Gmail OAuth client + refresh token (gmail.readonly)",
    Value: JSON.stringify({ clientId, clientSecret, refreshToken: token.refresh_token }),
  }),
);
console.log(`Connected. Saw ${labels.length} labels; stored the token in SSM ${PARAM}.`);
console.log("Next: AWS_PROFILE=admin pnpm gmail:check");
