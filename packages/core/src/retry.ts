/**
 * DynamoDB cancels a transaction with "TransactionConflict" when another transaction is touching
 * one of its items at the same moment (e.g. two issues from one sender both bumping that sender's
 * counters). That is transient, and the SDK does not retry it, so callers wrap transactions here.
 */

interface CancellationError {
  name?: string;
  CancellationReasons?: { Code?: string }[];
}

/**
 * A conflict worth retrying: a transaction where some item conflicted and no condition failed
 * outright, or a plain write to an item that a transaction is holding at that moment.
 */
export function isTransactionConflict(err: unknown): boolean {
  const e = err as CancellationError;
  if (e.name === "TransactionConflictException") return true;
  const codes = (e.CancellationReasons ?? []).map((r) => r.Code);
  return (
    e.name === "TransactionCanceledException" &&
    codes.includes("TransactionConflict") &&
    !codes.includes("ConditionalCheckFailed")
  );
}

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run `fn`, retrying transaction conflicts with jittered exponential backoff. */
export async function retryOnConflict<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 6;
  const baseMs = opts.baseMs ?? 40;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransactionConflict(err) || attempt >= attempts) throw err;
      const ceiling = baseMs * 2 ** (attempt - 1);
      await sleep(ceiling / 2 + Math.random() * ceiling); // jitter so colliding writers spread out
    }
  }
}
