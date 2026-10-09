import { describe, expect, it } from "vitest";
import { isTransactionConflict, retryOnConflict } from "../src/retry.js";

const cancelled = (...codes: string[]) =>
  Object.assign(new Error("Transaction cancelled"), {
    name: "TransactionCanceledException",
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

const noSleep = async () => undefined;

describe("isTransactionConflict", () => {
  it("is true for a conflict with no failed condition", () => {
    expect(isTransactionConflict(cancelled("None", "TransactionConflict"))).toBe(true);
  });
  it("is false when a condition failed (the write already happened)", () => {
    expect(isTransactionConflict(cancelled("ConditionalCheckFailed", "TransactionConflict"))).toBe(
      false,
    );
  });
  it("is true for a plain write that hit an item held by a transaction", () => {
    const err = Object.assign(new Error("Transaction is ongoing for the item"), {
      name: "TransactionConflictException",
    });
    expect(isTransactionConflict(err)).toBe(true);
  });
  it("is false for other errors", () => {
    expect(isTransactionConflict(new Error("boom"))).toBe(false);
    expect(isTransactionConflict(cancelled("ConditionalCheckFailed"))).toBe(false);
  });
});

describe("retryOnConflict", () => {
  it("retries conflicts until the transaction goes through", async () => {
    let calls = 0;
    const result = await retryOnConflict(
      async () => {
        calls++;
        if (calls < 3) throw cancelled("None", "TransactionConflict");
        return "ok";
      },
      { sleep: noSleep },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after the attempt limit", async () => {
    let calls = 0;
    await expect(
      retryOnConflict(
        async () => {
          calls++;
          throw cancelled("TransactionConflict");
        },
        { attempts: 4, sleep: noSleep },
      ),
    ).rejects.toThrow("Transaction cancelled");
    expect(calls).toBe(4);
  });

  it("does not retry anything else", async () => {
    let calls = 0;
    await expect(
      retryOnConflict(
        async () => {
          calls++;
          throw cancelled("ConditionalCheckFailed");
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
