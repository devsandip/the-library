export type Stage = "dev" | "prod";

export const REGION = "us-east-1";

/** Path the app is served under, on sandip.dev and on its own distribution. */
export const BASE_PATH = "/nutgraf";

/** Where the app was until 2026-10-12. Every URL under it moves, with a 301, to the same place under BASE_PATH. */
export const OLD_BASE_PATH = "/thelibrary";

/** Cognito managed-login domain prefix (prod). Fixed so the CSP can name it before the pool exists. */
export const COGNITO_DOMAIN_PREFIX = "thelibrary-sandip";
export const COGNITO_DOMAIN = `https://${COGNITO_DOMAIN_PREFIX}.auth.${REGION}.amazoncognito.com`;

export const PUBLIC_ORIGIN = "https://sandip.dev";

/**
 * srcdoc iframes inherit this policy, so it must allow newsletter images and inline styles.
 * Scripts stay locked to the app's own files. Fonts too: the app uses system fonts, and a
 * newsletter's own web font falls back to its font stack (none of 150 issues had one, #83).
 * See docs/architecture.md section 8.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self' data:",
  `connect-src 'self' ${COGNITO_DOMAIN}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

/** Alarm emails (SNS subscription must be confirmed once from the inbox). */
export const ALARM_EMAIL = "dev.sandip@gmail.com";

/** On since Gmail was connected and the backfill ran (2026-10-09, build plan R5). */
export const INGEST_SCHEDULE_ENABLED = true;

/**
 * Keys bound to readers (milestone 13 of docs/features/multi-reader.md): on, each request reads
 * and writes its reader's items and ingest the owner's; off, today's keys. Prod turns on only once
 * Sandip's items are copied to Sandip's keys (`pnpm move-to-reader`).
 */
export const READER_KEYS: Record<Stage, boolean> = { dev: true, prod: false };
