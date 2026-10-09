/**
 * Claude proposes the topic list from the issues stored in the last 30 days:
 *   AWS_PROFILE=admin pnpm topics            dry run: prints the proposal
 *   AWS_PROFILE=admin pnpm topics --apply    stores it (refused if a list exists)
 *   ... --replace                            replaces an existing list; then run
 *                                            `pnpm enrich --force` so issues follow
 *   ... --stage dev
 */
import type { TopicProposal } from "../services/ingest/src/enrich.js";
import { invokeIngest, numberArg, stageArg } from "./ingest-lambda.js";

const stage = stageArg();
const apply = process.argv.includes("--apply") || process.argv.includes("--replace");
const p = await invokeIngest<TopicProposal>(stage, {
  proposeTopics: {
    days: numberArg("--days", 30),
    apply,
    replace: process.argv.includes("--replace"),
  },
});

console.log(`${stage}: proposed from ${p.issues} issues:\n`);
for (const t of p.topics) console.log(`  ${t.name}: ${t.description}`);
if (p.applied) console.log("\nStored. Next: pnpm enrich");
else if (apply && p.existing?.length) {
  console.log("\nNot stored: a topic list exists. Use --replace, then pnpm enrich --force.");
} else console.log("\nDry run: nothing stored. Rerun with --apply to store it.");
