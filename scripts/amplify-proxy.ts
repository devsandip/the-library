/**
 * Manage the rewrite rules that expose Nutgraf at https://sandip.dev/nutgraf/.
 *
 *   pnpm amplify-proxy            # dry run: show current rules and what would change
 *   pnpm amplify-proxy --apply    # back up current rules, then insert/refresh our rules first
 *   pnpm amplify-proxy --remove   # back up current rules, then remove our rules
 *
 * Two rules, both proxying to the app's own distribution: "/nutgraf/<*>", where the app lives,
 * and "/thelibrary/<*>", where it lived until 2026-10-12 (the distribution answers those with a
 * 301 to the same place under /nutgraf/). Only rules with these sources are ever added, changed
 * or removed. The target domain is read from the TheLibrary-prod stack output, so rerun --apply
 * if the distribution is ever replaced.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AmplifyClient,
  GetAppCommand,
  UpdateAppCommand,
  type CustomRule,
} from "@aws-sdk/client-amplify";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";

const REGION = "us-east-1";
const APP_ID = "demw5c5zfs2r9"; // sandip.dev (Amplify Hosting)
const STACK = "TheLibrary-prod";
/** Our rules, first in this order: the app, then its old path. */
const PATHS = ["/nutgraf", "/thelibrary"];
const SOURCES = PATHS.map((p) => `${p}/<*>`);

const args = new Set(process.argv.slice(2));
const mode = args.has("--apply") ? "apply" : args.has("--remove") ? "remove" : "dry-run";

async function distributionDomain(): Promise<string> {
  const cfn = new CloudFormationClient({ region: REGION });
  const res = await cfn.send(new DescribeStacksCommand({ StackName: STACK }));
  const domain = res.Stacks?.[0]?.Outputs?.find(
    (o) => o.OutputKey === "DistributionDomain",
  )?.OutputValue;
  if (!domain) throw new Error(`${STACK} has no DistributionDomain output. Deploy it first.`);
  return domain;
}

const show = (label: string, rules: CustomRule[]) => {
  console.log(`\n${label}:`);
  for (const r of rules) console.log(`  ${r.status}  ${r.source}  ->  ${r.target}`);
  if (!rules.length) console.log("  (none)");
};

const amplify = new AmplifyClient({ region: REGION });
const app = (await amplify.send(new GetAppCommand({ appId: APP_ID }))).app;
if (!app) throw new Error(`Amplify app ${APP_ID} not found`);
const current = app.customRules ?? [];
const others = current.filter((r) => !SOURCES.includes(r.source ?? ""));

const next: CustomRule[] =
  mode === "remove"
    ? others
    : [
        ...(await distributionDomain().then((domain) =>
          PATHS.map((p) => ({
            source: `${p}/<*>`,
            target: `https://${domain}${p}/<*>`,
            status: "200",
          })),
        )),
        ...others,
      ];

console.log(`Amplify app ${APP_ID} (${app.name}), mode: ${mode}`);
show("Current rules", current);
show("Rules after", next);

if (JSON.stringify(current) === JSON.stringify(next)) {
  console.log("\nNo change needed.");
  process.exit(0);
}
if (mode === "dry-run") {
  console.log("\nDry run. Pass --apply or --remove to change the live app.");
  process.exit(0);
}

const backupDir = join(import.meta.dirname, "..", "scratch");
mkdirSync(backupDir, { recursive: true });
const backup = join(
  backupDir,
  `amplify-rules-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
writeFileSync(backup, JSON.stringify(current, null, 2) + "\n");
console.log(`\nBacked up current rules to ${backup}`);

await amplify.send(new UpdateAppCommand({ appId: APP_ID, customRules: next }));
const after = (await amplify.send(new GetAppCommand({ appId: APP_ID }))).app?.customRules ?? [];
show("Live rules now", after);
