import { convert } from "html-to-text";
import { Parser } from "htmlparser2";

export interface Anchor {
  href: string;
  text: string;
}

export function anchors(html: string): Anchor[] {
  const out: Anchor[] = [];
  let current: Anchor | undefined;
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (name === "a" && attribs.href) current = { href: attribs.href, text: "" };
      },
      ontext(text) {
        if (current) current.text += text;
      },
      onclosetag(name) {
        if (name === "a" && current) {
          out.push({ href: current.href, text: current.text.replace(/\s+/g, " ").trim() });
          current = undefined;
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return out;
}

export function htmlToCleanText(html: string): string {
  return tidy(
    convert(html, {
      wordwrap: false,
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "a", options: { ignoreHref: true } },
        { selector: "table", format: "block" },
        { selector: "tr", format: "block" },
        { selector: "td", format: "block" },
      ],
    }),
  );
}

function tidy(text: string): string {
  return (
    text
      // Zero-width preheader padding. Alternation, not a class: U+034F is a combining mark.
      .replace(/\u200b|\u200c|\u200d|\u00ad|\u034f|\ufeff/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Link text that marks a newsletter's housekeeping, never a story's source. */
const HOUSEKEEPING =
  /\b(unsubscribe|manage (your )?(preferences|subscriptions?)|update (your )?(profile|preferences)|(view|read|open) (it |this (email |post )?)?(online|in (your |a )?browser)|forward (this|it|to a friend)|share (this|it|on|via)|refer a friend|advertise)\b/i;

interface TextNode {
  type?: string;
  data?: string;
  children?: TextNode[];
}

const textOf = (node: TextNode): string =>
  node.type === "text" ? (node.data ?? "") : (node.children ?? []).map(textOf).join("");

/** A link's host, without "www.". */
function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A link made whole against the page it is on, when there is one; a fragment alone is none. */
function absolute(href: string, base: string | undefined): string {
  if (!base || /^https?:\/\//i.test(href)) return href;
  if (href.startsWith("#")) return "";
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/**
 * Clean text for the story index (#15), with links numbered: a link to an outside page becomes
 * "[n]" after its text, and its URL is `links[n - 1]`. Claude names a story's source by number,
 * so URLs never pass through the model. Housekeeping links (unsubscribe, share, view online) and
 * links without text (images) get no number. A web page's relative links count too, made whole
 * against its address (`base`), for the hunt for a story's original (#128), which also numbers
 * only the links it may follow (`keep`) and shows each one's host ("[3 arxiv.org]", `hosts`).
 */
export function storyText(
  html: string,
  opts: { base?: string; keep?: (href: string) => boolean; hosts?: boolean } = {},
): { text: string; links: string[] } {
  const links: string[] = [];
  const numbers = new Map<string, number>();
  const text = convert(html, {
    wordwrap: false,
    formatters: {
      numberedLink(elem, walk, builder) {
        walk(elem.children, builder);
        const href = absolute(String(elem.attribs?.href ?? "").trim(), opts.base);
        const label = textOf(elem).replace(/\s+/g, " ").trim();
        if (!/^https?:\/\//i.test(href) || !label || HOUSEKEEPING.test(label)) return;
        if (opts.keep && !opts.keep(href)) return;
        let n = numbers.get(href);
        if (n === undefined) {
          n = links.push(href);
          numbers.set(href, n);
        }
        builder.addInline(opts.hosts ? ` [${n} ${hostOf(href)}]` : ` [${n}]`);
      },
    },
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "a", format: "numberedLink" },
      { selector: "table", format: "block" },
      { selector: "tr", format: "block" },
      { selector: "td", format: "block" },
    ],
  });
  // Preheader padding leaves long runs of spaces, which cost tokens and say nothing.
  return { text: tidy(text).replace(/[^\S\n]{2,}/g, " "), links };
}

const VIEW_ONLINE =
  /\b(view|read|open)\b.{0,20}\b(online|in (your |a )?browser|on the web|on (the )?website)\b/i;

export function findViewOnlineUrl(
  links: Anchor[],
  opts: { substack: boolean },
): string | undefined {
  const byText = links.find((a) => /^https?:/i.test(a.href) && VIEW_ONLINE.test(a.text));
  if (byText) return byText.href;
  if (!opts.substack) return undefined;
  // Substack has no "view online" link; the first post permalink is the canonical one.
  return links.find((a) => /^https:\/\/[^/]+\/(pub\/[^/]+\/)?p\/[^/?#]+/i.test(a.href))?.href;
}

/** RFC 2369 header first (https entry), then the last "unsubscribe" link in the body. */
export function findUnsubscribeUrl(
  listUnsubscribeHeader: string | undefined,
  links: Anchor[],
): string | undefined {
  if (listUnsubscribeHeader) {
    const entries = [...listUnsubscribeHeader.matchAll(/<([^>]+)>/g)].map((m) => m[1] ?? "");
    const https = entries.find((e) => /^https:/i.test(e));
    if (https) return https;
  }
  const body = links.filter((a) => /^https?:/i.test(a.href) && /unsubscribe/i.test(a.text));
  if (body.length) return body[body.length - 1]?.href;
  if (listUnsubscribeHeader) {
    const mailto = [...listUnsubscribeHeader.matchAll(/<(mailto:[^>]+)>/gi)][0]?.[1];
    if (mailto) return mailto;
  }
  return undefined;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function readMinutes(words: number): number {
  return Math.max(1, Math.round(words / 230));
}
