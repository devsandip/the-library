/**
 * The hunt for the original (#23, #128): from the page a story links to, follow links to the page
 * its claims come from (the paper, filing, company post, repository, data or official statement),
 * up to five pages. Each page is read safely (`./page.ts`) with its links numbered, and Claude says
 * whether it is the original or which of its links lead there. Claude picks links by number, so it
 * never writes an address, and no page is read twice.
 */
import { READER, storyText } from "@library/core";
import type { SourceHop } from "@library/core/types";
import type { ClaudePort, ToolRequest } from "./claude.js";
import { PageError, type Page } from "./page.js";
import type { SourceStory } from "./source.js";

/** Pages read at most, those that could not be read included. */
export const MAX_PAGES = 5;
/** No page is started after this long, leaving the check room inside the job's 2 minutes. */
export const HUNT_BUDGET_MS = 70_000;
const PAGE_CHARS = 12_000;
const STORY_PASSAGE_CHARS = 1_500;
const MAX_NEXT = 3;

/** A page with its links numbered: "[n]" after a link's text, its address `links[n - 1]`. */
export interface NumberedPage {
  url: string;
  text: string;
  links: string[];
}

export function numberedPage(page: Page): NumberedPage {
  if (page.contentType.startsWith("text/plain")) {
    return { url: page.url, text: page.body.trim(), links: [] };
  }
  const { text, links } = storyText(page.body, { base: page.url });
  return { url: page.url, text, links };
}

export function findRequest(
  story: SourceStory,
  passage: string | undefined,
  page: NumberedPage,
): ToolRequest {
  return {
    system: [
      `You look for the original source behind one story in a reader's newsletter. ${READER}`,
      "",
      "The original is where the story's claims come from: the paper (or its abstract page), " +
        "the company's or organisation's own announcement, the filing, the repository, the " +
        "dataset, the court document or the official statement. A news report about any of " +
        "these is not the original.",
      "The user sends the story as the newsletter told it, then one page the search reached, " +
        "with each of its links marked [n].",
      "Call find_original:",
      "- readable: false if the page is not an article or document: a paywall, a sign-in or " +
        "cookie wall, an error page, a home page or a list of links.",
      "- original: true if this page is itself the original for the story's main claims.",
      "- what: when it is the original, what it is in a few words (\"Anthropic's own " +
        'announcement", "the paper on arXiv").',
      `- next: when it is not, up to ${MAX_NEXT} of its links most likely to be the original ` +
        "or to lead there, best first, each with the link's number and in a few words what " +
        "it is. Prefer links the page gives as its source (according to, in a post, the " +
        "paper, filed with) and links to the organisation the story is about. Never links " +
        "to other stories on the same site, sharing, sign-in or subscription pages. Empty " +
        "when the page links to nothing like that.",
      "- Only what the page shows: no outside knowledge, no addresses of your own. No em-dashes.",
    ].join("\n"),
    user: [
      `Newsletter: ${story.publication}`,
      `Headline: ${story.headline}`,
      `Summary: ${story.summary}`,
      `Names: ${story.names.join(", ") || "-"}`,
      ...(passage ? ["", "The newsletter's passage:", passage.slice(0, STORY_PASSAGE_CHARS)] : []),
      "",
      `The page (${page.url}):`,
      page.text.slice(0, PAGE_CHARS),
    ].join("\n"),
    tool: {
      name: "find_original",
      description: "Record whether this page is the story's original, or which links lead there.",
      schema: {
        type: "object",
        properties: {
          readable: { type: "boolean" },
          original: { type: "boolean" },
          what: { type: "string" },
          next: {
            type: "array",
            maxItems: MAX_NEXT,
            items: {
              type: "object",
              properties: { link: { type: "integer" }, what: { type: "string" } },
              required: ["link", "what"],
            },
          },
        },
        required: ["readable", "original", "next"],
      },
    },
    maxTokens: 400,
  };
}

/** What Claude found on a page, checked: links by number, only the page's own. */
export interface Finding {
  readable: boolean;
  original: boolean;
  what?: string;
  next: { url: string; what: string }[];
}

const short = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        .replace(/\s*—\s*/g, ", ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

export function parseFinding(input: unknown, page: NumberedPage): Finding {
  const o = (input ?? {}) as Record<string, unknown>;
  const readable = o.readable !== false;
  const original = readable && o.original === true;
  const what = short(o.what, 80);
  const next = (Array.isArray(o.next) ? o.next : []).flatMap((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    const n = Number(r.link);
    const url = Number.isInteger(n) ? page.links[n - 1] : undefined;
    return url ? [{ url, what: short(r.what, 80) }] : [];
  });
  return {
    readable,
    original,
    ...(original && what ? { what } : {}),
    next: original || !readable ? [] : next.slice(0, MAX_NEXT),
  };
}

/** A page address without its fragment, so "#section" links count as the page. */
const pageOf = (url: string) => url.replace(/#.*$/, "");

export interface Hunt {
  /** Every page tried, in order, the story's own link first. */
  path: SourceHop[];
  /** The page to check: the original when found, otherwise the first that could be read. */
  page?: Page;
  original: boolean;
  /** Why the story's own page could not be read, when no page could. */
  failed?: string;
  calls: { inputTokens: number; outputTokens: number }[];
}

/**
 * Follows links from the story's page towards its original, depth first: a page's best link is
 * read before the page before's second. Stops at the original, at five pages, or when time is up.
 */
export async function hunt(
  story: SourceStory & { link: string },
  passage: string | undefined,
  deps: {
    read: (link: string) => Promise<Page>;
    claude: ClaudePort;
    now: () => number;
    /** Told the pages so far and the one being read, for the run's progress. */
    progress?: (path: SourceHop[], reading?: string) => Promise<void>;
  },
): Promise<Hunt> {
  const started = deps.now();
  const path: SourceHop[] = [];
  const seen = new Set<string>();
  const calls: Hunt["calls"] = [];
  const stack: { url: string; why?: string }[] = [{ url: story.link }];
  let first: Page | undefined;
  let failed: string | undefined;

  while (stack.length && path.length < MAX_PAGES && deps.now() - started < HUNT_BUDGET_MS) {
    const next = stack.shift()!;
    if (seen.has(pageOf(next.url))) continue;
    seen.add(pageOf(next.url));
    await deps.progress?.([...path], next.url);

    let page: Page;
    try {
      page = await deps.read(next.url);
    } catch (err) {
      if (!(err instanceof PageError)) throw err;
      path.push({ url: next.url, ...(next.why ? { why: next.why } : {}), failed: err.message });
      if (path.length === 1) failed = err.message;
      continue;
    }
    // A redirect may land on a page read already.
    if (path.length && seen.has(pageOf(page.url)) && pageOf(page.url) !== pageOf(next.url))
      continue;
    seen.add(pageOf(page.url));
    const hop: SourceHop = { url: page.url, ...(next.why ? { why: next.why } : {}) };
    path.push(hop);

    const numbered = numberedPage(page);
    if (numbered.text.length < 200) continue;
    const res = await deps.claude.callTool(findRequest(story, passage, numbered));
    calls.push(res);
    const found = parseFinding(res.input, numbered);
    if (!found.readable) continue;
    first ??= page;
    if (found.original) {
      if (found.what) hop.what = found.what;
      await deps.progress?.([...path]);
      return { path, page, original: true, calls };
    }
    stack.unshift(...found.next.map((l) => ({ url: l.url, why: l.what })));
  }
  await deps.progress?.([...path]);
  return {
    path,
    ...(first ? { page: first } : {}),
    original: false,
    ...(failed ? { failed } : {}),
    calls,
  };
}
