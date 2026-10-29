/**
 * Highlights into the Obsidian vault (#169): one note per issue, its passages as quotes with their
 * notes, read through the API Lambda with the laptop's AWS profile (no app password or token kept
 * on the Mac):
 *   AWS_PROFILE=admin pnpm highlights-obsidian                 prod, into ~/Documents/Obsidian/Highlights
 *   ... --stage dev                                           the dev stack
 *   ... --vault <path> --folder <name>                        another vault or folder
 *   ... --dry-run                                             print what it would write, write nothing
 * The script rewrites only its own block and properties in a note; Sandip's own text is kept. A
 * note is found again by its `nutgraf_id`, so it can be renamed or moved within the folder's top.
 * Highlights deleted in Nutgraf leave their notes, saying none are left. A run with nothing new
 * writes nothing.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { byIssue } from "@library/core/highlights";
import { emptiedNote, issueNote, noteIssueId, noteName } from "@library/core/obsidian";
import type { HighlightListItem, HighlightsResponse } from "@library/core/types";
import { BASE_PATH, PUBLIC_ORIGIN, REGION } from "../infra/lib/config.js";
import { stageArg } from "./ingest-lambda.js";

const arg = (name: string) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;

const stage = stageArg();
const dry = process.argv.includes("--dry-run");
const vault = arg("--vault") ?? join(homedir(), "Documents", "Obsidian");
const folder = join(vault, arg("--folder") ?? "Highlights");
/** Links in the notes open the app; dev has no web app of its own, so they point at prod's. */
const appUrl = `${PUBLIC_ORIGIN}${BASE_PATH}`;

/** GET a path of the stage's API, by invoking its Lambda as API Gateway would. */
async function get<T>(fn: string, path: string, query: Record<string, string>): Promise<T> {
  const event = {
    version: "2.0",
    rawPath: `${BASE_PATH}/api${path}`,
    rawQueryString: new URLSearchParams(query).toString(),
    queryStringParameters: query,
    headers: {},
    isBase64Encoded: false,
    requestContext: {
      http: { method: "GET", path: `${BASE_PATH}/api${path}` },
      authorizer: { jwt: { claims: { sub: "highlights-obsidian" }, scopes: [] } },
    },
  };
  const res = await new LambdaClient({ region: REGION }).send(
    new InvokeCommand({ FunctionName: fn, Payload: Buffer.from(JSON.stringify(event)) }),
  );
  const out = JSON.parse(Buffer.from(res.Payload ?? []).toString() || "null") as {
    statusCode?: number;
    body?: string;
    errorMessage?: string;
  } | null;
  if (res.FunctionError || !out || out.statusCode !== 200) {
    throw new Error(`GET ${path}: ${out?.errorMessage ?? out?.body ?? "no answer"}`);
  }
  return JSON.parse(out.body!) as T;
}

/** Every highlight, newest first, 200 a page. */
async function readHighlights(): Promise<HighlightListItem[]> {
  const stack = (
    await new CloudFormationClient({ region: REGION }).send(
      new DescribeStacksCommand({ StackName: `TheLibrary-${stage}` }),
    )
  ).Stacks?.[0];
  const fn = stack?.Outputs?.find((o) => o.OutputKey === "ApiFunction")?.OutputValue;
  if (!fn) throw new Error(`TheLibrary-${stage} has no ApiFunction output`);
  const items: HighlightListItem[] = [];
  let before: string | undefined;
  do {
    const page = await get<HighlightsResponse>(fn, "/highlights", {
      limit: "200",
      ...(before ? { before } : {}),
    });
    items.push(...page.items);
    before = page.next;
  } while (before);
  return items;
}

/** The notes already in the folder (its top level), by the issue they were made for. */
async function notesByIssue(): Promise<Map<string, { file: string; text: string }>> {
  const found = new Map<string, { file: string; text: string }>();
  const names = await readdir(folder).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [] as string[];
    throw e;
  });
  for (const name of names.filter((n) => n.endsWith(".md"))) {
    const text = await readFile(join(folder, name), "utf8");
    const id = noteIssueId(text);
    if (id) found.set(id, { file: name, text });
  }
  return found;
}

const highlights = await readHighlights();
const groups = byIssue(highlights);
const existing = await notesByIssue();
const taken = new Set(
  (await readdir(folder).catch(() => [] as string[])).map((n) => n.toLowerCase()),
);
const made: string[] = [];
const updated: string[] = [];
let unchanged = 0;

const put = async (file: string, text: string) => {
  if (!dry) await writeFile(join(folder, file), text, "utf8");
};

if (!dry && groups.length) await mkdir(folder, { recursive: true });
for (const g of groups) {
  const note = existing.get(g.issue.id);
  existing.delete(g.issue.id);
  if (note) {
    const text = issueNote(g.issue, g.highlights, appUrl, note.text);
    if (text === note.text) unchanged++;
    else {
      await put(note.file, text);
      updated.push(note.file);
    }
    continue;
  }
  // A new note; another issue's note may already have its name.
  const base = noteName(g.issue).slice(0, -".md".length);
  let file = `${base}.md`;
  for (let k = 2; taken.has(file.toLowerCase()); k++) file = `${base} (${k}).md`;
  taken.add(file.toLowerCase());
  await put(file, issueNote(g.issue, g.highlights, appUrl));
  made.push(file);
}
// Notes whose issue has no highlights left (deleted, or the issue filtered since).
for (const note of existing.values()) {
  const text = emptiedNote(note.text);
  if (text === note.text) unchanged++;
  else {
    await put(note.file, text);
    updated.push(note.file);
  }
}

const list = (title: string, files: string[]) => {
  if (!files.length) return;
  console.log(`\n${title} (${files.length}):`);
  for (const f of files) console.log(`  ${f}`);
};
console.log(
  `${stage}: ${highlights.length} highlights from ${groups.length} issues -> ${folder}` +
    (dry ? " (dry run: nothing written)" : ""),
);
list("New notes", made);
list("Updated", updated);
console.log(
  made.length || updated.length
    ? `\n${unchanged} unchanged.`
    : `\nNothing new: ${unchanged} notes as they were.`,
);
