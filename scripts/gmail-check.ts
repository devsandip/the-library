/**
 * Verify the stored Gmail token and preview what ingest would fetch:
 *   AWS_PROFILE=admin pnpm gmail:check [--days 28]
 * Prints counts only; no message content.
 */
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { gmailQuery, NEWSLETTER_LABEL_IDS } from "@library/core";
import { Gmail, type GmailCredentials } from "../services/ingest/src/gmail.js";

const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || 28;
const PARAM = "/thelibrary/prod/gmail/oauth";

const res = await new SSMClient({ region: "us-east-1" }).send(
  new GetParameterCommand({ Name: PARAM, WithDecryption: true }),
);
const gmail = new Gmail(JSON.parse(res.Parameter!.Value!) as GmailCredentials);

const labels = await gmail.listLabels();
for (const id of NEWSLETTER_LABEL_IDS) {
  const label = labels.find((l) => l.id === id);
  console.log(`${label ? "found  " : "MISSING"} ${id}${label ? ` (${label.name})` : ""}`);
}
const query = gmailQuery(days);
const ids = await gmail.listMessageIds(query, 5000);
console.log(`\nQuery: ${query}`);
console.log(
  `${ids.length} messages in the last ${days} days would be considered (newsletters + noise).`,
);
