/**
 * Check the source (#23, the first version): a story against the page it links to. The page is
 * read safely (`./page.ts`) and turned into text; one Claude call lists the story's claims, each
 * with what the page says, a quote and a verdict: holds up, goes further than the source, or not
 * in the source. Quotes are checked against the page, so a quote shown is the page's own words.
 *
 * A check runs in the jobs Lambda (`./jobs.ts`), so it is not held to the API's 28 seconds: the
 * API starts it and answers at once, and GET says it is running until it is kept or says why not.
 *
 * One page: the hunt for the primary source behind a news report is the next step. Written only
 * when the reader asks, and kept for the story.
 */
import { CLAUDE_MODEL, claudeCents, htmlToCleanText, READER } from "@library/core";
import type { SourceCheck, SourceClaim, SourceResponse, SourceVerdict } from "@library/core/types";
import type { ClaudePort, ToolRequest } from "./claude.js";
import { notFound } from "./errors.js";
import { fetchPage, PageError, type Page } from "./page.js";
import type { Job, SourcePort } from "./port.js";

/** The page's text Claude reads at most, and the newsletter's. */
const PAGE_CHARS = 12_000;
const PASSAGE_CHARS = 3_000;
const MAX_CLAIMS = 5;
const VERDICTS: readonly SourceVerdict[] = ["holds", "further", "missing"];
/** How long a run may say it is running: the jobs Lambda stops at 2 minutes. */
export const RUN_LIMIT_MS = 3 * 60_000;

export const NO_LINK = "This story has no source link to check.";
export const UNREADABLE =
  "The source could not be read as an article: it may be behind a paywall or a sign-in.";
export const STOPPED = "The check did not finish. Try again.";

/** A story as the check reads it: what it says, where it links, and its newsletter's text. */
export interface SourceStory {
  issueId: string;
  n: number;
  publication: string;
  headline: string;
  summary: string;
  names: string[];
  link?: string;
  /** The issue's clean text, when it is still kept. */
  text?: string;
}

/** Where checks read from and are kept. DynamoRepo implements it; tests use a fake. */
export interface SourceStore {
  /** The story, with its issue's text unless `text` is false. */
  sourceStory(id: string, n: number, opts?: { text?: boolean }): Promise<SourceStory | undefined>;
  /** The kept check and the latest run, either of which may be missing. */
  getSource(id: string, n: number): Promise<{ check?: SourceCheck; run?: SourceRunItem }>;
  /** Marks a run started; false when one started after `staleBefore` is still running. */
  startRun(id: string, n: number, since: string, staleBefore: string): Promise<boolean>;
  /** Ends the run with no check: why there is none, or nothing when it failed. */
  endRun(id: string, n: number, none?: string): Promise<void>;
  /** Keeps the check, replacing any earlier one, and ends its run. */
  putSource(id: string, n: number, check: StoredSource): Promise<void>;
}

export interface StoredSource extends SourceCheck {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** The latest run of a story's check, until a check is kept: running, none (why) or failed. */
export interface SourceRunItem {
  status: "running" | "none" | "failed";
  since: string;
  none?: string;
}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];

/**
 * The newsletter's passage about the story: the paragraph sharing the most words with its
 * headline and names, with its neighbours, so a digest's other items stay out.
 */
export function passage(text: string, story: Pick<SourceStory, "headline" | "names">): string {
  if (text.length <= PASSAGE_CHARS) return text;
  const want = new Set(words(`${story.headline} ${story.names.join(" ")}`));
  const paras = text.split(/\n\s*\n/);
  let best = 0;
  let bestScore = -1;
  paras.forEach((p, k) => {
    const score = new Set(words(p).filter((w) => want.has(w))).size;
    if (score > bestScore) [best, bestScore] = [k, score];
  });
  return paras
    .slice(Math.max(0, best - 1), best + 2)
    .join("\n\n")
    .slice(0, PASSAGE_CHARS);
}

/** The page as text: HTML through the same converter newsletters use. */
export function pageText(page: Page): string {
  const text = page.contentType.startsWith("text/plain") ? page.body : htmlToCleanText(page.body);
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function sourceRequest(story: SourceStory, page: string, url: string): ToolRequest {
  return {
    system: [
      `You check what one reader's newsletter said against the page it links to. ${READER}`,
      "",
      "The user sends the story as the newsletter told it (its headline, summary, the names in " +
        "it, and the newsletter's own passage), then the text of the page the story links to.",
      "Call check_source:",
      "- readable: false if the page is not an article that could support the story: a paywall, " +
        "a sign-in or cookie wall, an error page, a home page or a list of links. Then no claims.",
      `- claims: the story's main factual claims (numbers, names, dates, what was said or done), ` +
        `at most ${MAX_CLAIMS}. For each: claim, what the newsletter says, in one sentence; ` +
        "source, what the page says about it, in one sentence; quote, the page's exact words " +
        "that show it, at most 30 words, copied exactly; verdict: holds (the page says it), " +
        "further (the newsletter goes further than the page: a bigger number, a stronger word, " +
        "something the page only suggests) or missing (the page does not say it).",
      "- verdict: holds, further or missing for the story as a whole, or mixed.",
      "- note: one sentence, only if it matters, for example that the page itself reports " +
        "another publication's story.",
      "- Only what the two texts say: no outside knowledge. No em-dashes.",
    ].join("\n"),
    user: [
      `Newsletter: ${story.publication}`,
      `Headline: ${story.headline}`,
      `Summary: ${story.summary}`,
      `Names: ${story.names.join(", ") || "-"}`,
      "",
      "The newsletter's passage:",
      story.text ? passage(story.text, story) : "(not kept)",
      "",
      `The page (${url}):`,
      page.slice(0, PAGE_CHARS),
    ].join("\n"),
    tool: {
      name: "check_source",
      description: "Record how the story's claims stand against the page it links to.",
      schema: {
        type: "object",
        properties: {
          readable: { type: "boolean" },
          claims: {
            type: "array",
            maxItems: MAX_CLAIMS,
            items: {
              type: "object",
              properties: {
                claim: { type: "string" },
                source: { type: "string" },
                quote: { type: "string" },
                verdict: { type: "string", enum: [...VERDICTS] },
              },
              required: ["claim", "source", "verdict"],
            },
          },
          verdict: { type: "string", enum: [...VERDICTS, "mixed"] },
          note: { type: "string" },
        },
        required: ["readable", "claims", "verdict"],
      },
    },
    maxTokens: 1500,
  };
}

/** Whitespace squeezed, and the reader's house style: no em-dashes. */
const clean = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        .replace(/\s*—\s*/g, ", ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/** Text compared for a quote: case, spacing and curly quotes set aside. */
const comparable = (s: string) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/**
 * Claude's check, checked. A claim needs its claim, what the source says and a known verdict; a
 * quote is kept only when the page holds it word for word. Undefined when the page was not an
 * article or no claim is left.
 */
export function parseSource(
  input: unknown,
  page: string,
): Pick<SourceCheck, "verdict" | "claims" | "note"> | undefined {
  const o = (input ?? {}) as Record<string, unknown>;
  if (o.readable === false || !Array.isArray(o.claims)) return undefined;
  const onPage = comparable(page);
  const claims = o.claims.slice(0, MAX_CLAIMS).flatMap((c): SourceClaim[] => {
    const r = (c ?? {}) as Record<string, unknown>;
    const claim = clean(r.claim, 300);
    const source = clean(r.source, 300);
    const verdict = VERDICTS.find((v) => v === r.verdict);
    if (!claim || !source || !verdict) return [];
    const quote = clean(r.quote, 300).replace(/^["“]|["”]$/g, "");
    const real = quote.length >= 8 && onPage.includes(comparable(quote));
    return [{ claim, source, ...(real ? { quote } : {}), verdict }];
  });
  if (!claims.length) return undefined;
  const asked = [...VERDICTS, "mixed" as const].find((v) => v === o.verdict);
  // Claude's overall verdict, or one worked out from the claims when it gave none.
  const verdict =
    asked ?? (claims.every((c) => c.verdict === claims[0]!.verdict) ? claims[0]!.verdict : "mixed");
  const note = clean(o.note, 300);
  return { verdict, claims, ...(note ? { note } : {}) };
}

/** The API's side: what is kept or running for a story, and starting a run in the background. */
export class Sources implements SourcePort {
  constructor(
    private readonly store: SourceStore,
    private readonly startJob: (job: Job) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  /** The run going now, or why the latest run kept nothing, or the kept check. */
  async get(id: string, n: number): Promise<SourceResponse> {
    await this.story(id, n);
    const { check, run } = await this.store.getSource(id, n);
    if (run?.status === "running") {
      const fresh = this.now() - Date.parse(run.since) < RUN_LIMIT_MS;
      return fresh ? { running: { since: run.since } } : { none: STOPPED };
    }
    // A kept check ends its run, so a run still here is newer than any check.
    if (run) return { none: run.none ?? STOPPED };
    return check ? { check } : {};
  }

  /** Starts a check in the jobs Lambda, or answers the one already running. */
  async run(id: string, n: number): Promise<SourceResponse> {
    const story = await this.story(id, n);
    if (!story.link) return { none: NO_LINK };
    const now = this.now();
    const since = new Date(now).toISOString();
    const stale = new Date(now - RUN_LIMIT_MS).toISOString();
    if (!(await this.store.startRun(id, n, since, stale))) return this.get(id, n);
    try {
      await this.startJob({ kind: "source", id, n });
    } catch (err) {
      await this.store.endRun(id, n);
      throw err;
    }
    return { running: { since } };
  }

  private async story(id: string, n: number): Promise<SourceStory> {
    const story = await this.store.sourceStory(id, n, { text: false });
    if (!story) throw notFound(`issue ${id} has no story ${n}`);
    return story;
  }
}

/**
 * The jobs Lambda's side: reads the page, asks Claude, and keeps the check, or ends the run with
 * why there is none. Anything else that goes wrong ends the run as failed, and is thrown.
 */
export class SourceChecker {
  constructor(
    private readonly store: SourceStore,
    private readonly claude: ClaudePort,
    private readonly read: (link: string) => Promise<Page> = fetchPage,
    private readonly now: () => number = Date.now,
  ) {}

  async check(id: string, n: number): Promise<SourceResponse> {
    try {
      const r = await this.attempt(id, n);
      if (!r.check) await this.store.endRun(id, n, r.none);
      return r;
    } catch (err) {
      await this.store.endRun(id, n);
      throw err;
    }
  }

  private async attempt(id: string, n: number): Promise<SourceResponse> {
    const started = this.now();
    const story = await this.store.sourceStory(id, n);
    if (!story) throw notFound(`issue ${id} has no story ${n}`);
    if (!story.link) return { none: NO_LINK };
    let page: Page;
    try {
      page = await this.read(story.link);
    } catch (err) {
      if (err instanceof PageError)
        return { none: `The source could not be read: ${err.message}.` };
      throw err;
    }
    const text = pageText(page);
    if (text.length < 200) return { none: UNREADABLE };

    const res = await this.claude.callTool(sourceRequest(story, text, page.url));
    const parsed = parseSource(res.input, text.slice(0, PAGE_CHARS));
    if (!parsed) return { none: UNREADABLE };
    const check: SourceCheck = {
      url: page.url,
      ...parsed,
      at: new Date(started).toISOString(),
      ms: this.now() - started,
      cents: claudeCents(res.inputTokens, res.outputTokens),
    };
    await this.store.putSource(id, n, {
      ...check,
      model: CLAUDE_MODEL,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
    });
    console.log(
      JSON.stringify({
        level: "info",
        msg: "source checked",
        story: `${id}#${n}`,
        verdict: check.verdict,
        claims: check.claims.length,
        quotes: check.claims.filter((c) => c.quote).length,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        ms: check.ms,
      }),
    );
    return { check };
  }
}
