/**
 * Who a request, a job or a script works for (#176): a reader, by their Cognito `sub`. Nutgraf
 * opens to any reader in steps (`docs/features/multi-reader.md`); until the keys carry the reader
 * (milestone 13), every reader reads the one library.
 */
export interface Reader {
  readonly id: string;
}

/** A Cognito `sub` (a UUID), or a test reader's name on dev. */
const READER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The reader a sign-in token's `sub` (or a job's `reader`) names; undefined for anything else. */
export function readerOf(sub: unknown): Reader | undefined {
  return typeof sub === "string" && READER_ID.test(sub) ? { id: sub } : undefined;
}

/**
 * The Cognito group of operators (#224): they see how the mail runs went on Status and may check
 * the mail now. Readers see their own status only.
 */
export const OPERATORS_GROUP = "operators";

/**
 * The groups a sign-in token's `cognito:groups` claim names. API Gateway hands an array claim to
 * the Lambda as one string, `[operators other]`; a test may pass the array itself.
 */
export function groupsOf(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim.filter((g): g is string => typeof g === "string");
  if (typeof claim !== "string") return [];
  return claim
    .replace(/^\[|\]$/g, "")
    .split(/[\s,]+/)
    .filter(Boolean);
}
