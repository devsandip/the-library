export type Stage = "dev" | "prod";

export const REGION = "us-east-1";

/** Path the app is served under, on sandip.dev and on its own distribution. */
export const BASE_PATH = "/thelibrary";

/** Cognito managed-login domain prefix (prod). Fixed so the CSP can name it before the pool exists. */
export const COGNITO_DOMAIN_PREFIX = "thelibrary-sandip";
export const COGNITO_DOMAIN = `https://${COGNITO_DOMAIN_PREFIX}.auth.${REGION}.amazoncognito.com`;

export const PUBLIC_ORIGIN = "https://sandip.dev";

/**
 * srcdoc iframes inherit this policy, so it must allow newsletter images and inline styles.
 * Scripts stay locked to the app's own files. See docs/architecture.md section 8.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self' https: data:",
  `connect-src 'self' ${COGNITO_DOMAIN}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");
