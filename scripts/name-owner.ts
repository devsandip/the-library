/**
 * The owner (#180): the reader whose Gmail the poller reads and whom the scheduled jobs serve,
 * kept in `CONFIG/OWNER`.
 *   AWS_PROFILE=admin pnpm name-owner                       prod: the one Cognito account is the owner
 *   ... --email <address>                              prod: the account with that email
 *   ... --stage dev --id <reader id>                   dev has no Cognito: name a test reader
 *   ... --show                                         print the owner, change nothing
 * Naming another owner than the one named needs --replace: once keys carry the reader
 * (milestone 13 of docs/features/multi-reader.md), the owner's library is the Gmail poller's.
 */
import { execFileSync } from "node:child_process";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { readerOf, type Reader } from "@library/core/reader";
import { Store } from "../services/ingest/src/store.js";
import { stageArg } from "./ingest-lambda.js";

const REGION = "us-east-1";
const arg = (name: string) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;

const stage = stageArg();
const stack = (
  await new CloudFormationClient({ region: REGION }).send(
    new DescribeStacksCommand({ StackName: `TheLibrary-${stage}` }),
  )
).Stacks?.[0];
const out = (key: string) => stack?.Outputs?.find((o) => o.OutputKey === key)?.OutputValue;
const table = out("TableName");
const bucket = out("ContentBucket");
if (!table || !bucket) throw new Error(`TheLibrary-${stage} has no TableName or ContentBucket`);
const store = new Store(table, bucket);

const current = await store.owner();
if (process.argv.includes("--show")) {
  console.log(`${stage}: ${current ? `the owner is ${current.id}` : "no owner named"}`);
  process.exit(0);
}

/** The Cognito account by email, or the only account; its `sub` is the reader's id. */
function cognitoReader(email: string | undefined): { reader: Reader; email: string } {
  const pool = out("UserPoolId");
  if (!pool) throw new Error(`TheLibrary-${stage} has no user pool: pass --id`);
  const args = ["cognito-idp", "list-users", "--region", REGION, "--user-pool-id", pool];
  if (email) args.push("--filter", `email = "${email.replace(/"/g, "")}"`);
  const users = (
    JSON.parse(execFileSync("aws", [...args, "--output", "json"], { encoding: "utf8" })) as {
      Users: { Attributes: { Name: string; Value: string }[] }[];
    }
  ).Users;
  if (users.length !== 1) {
    throw new Error(
      email ? `${users.length} accounts with ${email}` : `${users.length} accounts: pass --email`,
    );
  }
  const attr = (name: string) => users[0]!.Attributes.find((a) => a.Name === name)?.Value;
  const reader = readerOf(attr("sub"));
  if (!reader) throw new Error("the account has no sub");
  return { reader, email: attr("email") ?? "" };
}

const id = arg("--id");
const named = id ? { reader: readerOf(id), email: undefined } : cognitoReader(arg("--email"));
if (!named.reader) throw new Error(`not a reader id: ${id}`);
if (current && current.id !== named.reader.id && !process.argv.includes("--replace")) {
  console.error(`${stage}: the owner is ${current.id}; pass --replace to name ${named.reader.id}`);
  process.exit(1);
}
await store.setOwner(named.reader, named.email || undefined);
console.log(
  `${stage}: the owner is ${named.reader.id}${named.email ? ` (${named.email})` : ""}` +
    (current?.id === named.reader.id ? ", as before" : ""),
);
