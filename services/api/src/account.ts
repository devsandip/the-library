/**
 * Deleting a reader's account (#220). The API checks and starts it; the jobs Lambda deletes
 * every item and object, then the reader's sign-in. Refused on today's keys, where there is one
 * library, and for the owner, whose library the Gmail poller fills.
 */
import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { Reader } from "@library/core/reader";
import { HttpError } from "./errors.js";
import type { Job } from "./port.js";

export interface AccountStore {
  deletable(): Promise<"yes" | "today's keys" | "owner">;
}

export interface AccountPort {
  /** Starts deleting the reader's account; answers once the job has started. */
  delete(): Promise<{ deleting: true }>;
}

export class Accounts implements AccountPort {
  constructor(
    private readonly store: AccountStore,
    private readonly reader: Reader,
    private readonly startJob: (job: Job) => Promise<void>,
  ) {}

  async delete(): Promise<{ deleting: true }> {
    const why = await this.store.deletable();
    if (why === "today's keys") {
      throw new HttpError(
        409,
        "Accounts can be deleted once Nutgraf keeps each reader's own library.",
      );
    }
    if (why === "owner") {
      throw new HttpError(
        409,
        "The owner's account holds the library the mail comes into; it can't be deleted here.",
      );
    }
    await this.startJob({ kind: "delete-account", reader: this.reader.id });
    return { deleting: true };
  }
}

/**
 * The reader's sign-in deleted from the user pool, found by their `sub` (#220). Nothing to do
 * where there is no pool (dev) or no such user (deleted already).
 */
export async function deleteSignIn(
  reader: Reader,
  poolId: string | undefined,
  client: Pick<CognitoIdentityProviderClient, "send"> = new CognitoIdentityProviderClient({}),
): Promise<boolean> {
  if (!poolId) return false;
  const found = await client.send(
    new ListUsersCommand({ UserPoolId: poolId, Filter: `sub = "${reader.id}"`, Limit: 1 }),
  );
  const username = found.Users?.[0]?.Username;
  if (!username) return false;
  await client.send(new AdminDeleteUserCommand({ UserPoolId: poolId, Username: username }));
  return true;
}
