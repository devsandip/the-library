/**
 * Score Jev's News or Learning call (#81) against Sandip's labels:
 *   AWS_PROFILE=admin pnpm jev:score scratch/story-labels.json
 *
 * The file is a list of stories: { n, publication, headline, summary, label, guess?, issueShelf? },
 * where label is Sandip's ("news" or "learning"), guess is Claude's before he looked, and
 * issueShelf is the shelf Haiku gave the whole issue. Prints accuracy and calibration for each
 * question in SHELF_QUESTIONS (add a rewording there to compare), beside those two baselines, and writes Jev's answers to
 * <file>.jev.json. Reads the key from SSM; prints no key and stores nothing in the table.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { mapLimit } from "../services/ingest/src/ingest.js";
import {
  JEV_PARAM,
  Jev,
  SHELF_QUESTIONS,
  learningProbability,
  storyState,
} from "../services/ingest/src/jev.js";

type Shelf = "news" | "learning";
interface Labeled {
  n: number;
  publication: string;
  headline: string;
  summary: string;
  label?: Shelf;
  guess?: Shelf;
  issueShelf?: Shelf | null;
}

const file = process.argv[2];
if (!file) throw new Error("usage: pnpm jev:score <labels.json>");
const stories = JSON.parse(readFileSync(file, "utf8")) as Labeled[];
const unlabeled = stories.filter((s) => !s.label).length;
if (unlabeled === stories.length) {
  console.log("No labels yet: scoring against Claude's guesses instead.\n");
  for (const s of stories) s.label = s.guess;
} else if (unlabeled) throw new Error(`${unlabeled} stories have no label`);

const res = await new SSMClient({ region: "us-east-1" }).send(
  new GetParameterCommand({ Name: JEV_PARAM, WithDecryption: true }),
);
const jev = new Jev(res.Parameter!.Value!.trim());

const phrasings = Object.keys(SHELF_QUESTIONS) as (keyof typeof SHELF_QUESTIONS)[];
let inputTokens = 0;
let model = "";
const scored: (Labeled & { p: Record<string, number> })[] = [];
await mapLimit(stories, 4, async (s) => {
  const d = await jev.decide(storyState(s), SHELF_QUESTIONS);
  inputTokens += d.inputTokens;
  model = d.model;
  const p = Object.fromEntries(phrasings.map((q) => [q, learningProbability(d.answers[q])]));
  scored.push({ ...s, p });
});
scored.sort((a, b) => a.n - b.n);
writeFileSync(file.replace(/\.json$/, "") + ".jev.json", JSON.stringify(scored, null, 1));

const pct = (k: number, n: number) => `${k}/${n} (${Math.round((100 * k) / n)}%)`;
const call = (p: number): Shelf => (p >= 0.5 ? "learning" : "news");
const learning = scored.filter((s) => s.label === "learning").length;
console.log(
  `${model}, ${scored.length} stories: ${learning} Learning, ${scored.length - learning} News.`,
);
console.log(`${inputTokens} input tokens.\n`);

const right = (pick: (s: (typeof scored)[number]) => Shelf | null | undefined) =>
  scored.filter((s) => pick(s) === s.label).length;
console.log("Agreement with the labels:");
for (const q of phrasings)
  console.log(
    `  jev ${q.padEnd(6)} ${pct(
      right((s) => call(s.p[q]!)),
      scored.length,
    )}`,
  );
if (unlabeled === 0 && scored.some((s) => s.guess)) {
  console.log(
    `  claude guess ${pct(
      right((s) => s.guess),
      scored.length,
    )}`,
  );
}
console.log(
  `  issue shelf  ${pct(
    right((s) => s.issueShelf),
    scored.length,
  )} (Haiku, whole issue)`,
);

// Calibration: of the stories Jev put in each band, how many are Learning?
const bands = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
for (const q of phrasings) {
  console.log(`\njev ${q}: P(learning) band, stories, labelled Learning`);
  for (let b = 0; b < bands.length - 1; b++) {
    const inBand = scored.filter((s) => s.p[q]! >= bands[b]! && s.p[q]! < bands[b + 1]!);
    if (!inBand.length) continue;
    const l = inBand.filter((s) => s.label === "learning").length;
    console.log(
      `  ${bands[b]!.toFixed(1)} to ${Math.min(bands[b + 1]!, 1).toFixed(1)}  ${String(inBand.length).padStart(3)}  ${pct(l, inBand.length)}`,
    );
  }
  const wrong = scored.filter((s) => call(s.p[q]!) !== s.label);
  console.log(`  wrong (${wrong.length}):`);
  for (const s of wrong) {
    console.log(
      `    ${String(s.n).padStart(2)} p=${s.p[q]!.toFixed(2)} label=${s.label}  ${s.publication}: ${s.headline}`,
    );
  }
}
