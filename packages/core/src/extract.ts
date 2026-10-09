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
  return (
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
    })
      // Zero-width preheader padding. Alternation, not a class: U+034F is a combining mark.
      .replace(/\u200b|\u200c|\u200d|\u00ad|\u034f|\ufeff/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
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
