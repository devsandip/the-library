import sanitizeHtml from "sanitize-html";
import { REDIRECT_PARAMS, TRACKER_HOSTS, TRACKER_PATHS } from "./sources.js";

const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  "img",
  "style",
  "center",
  "font",
  "span",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "picture",
  "source",
  "figure",
  "figcaption",
  "hr",
  "br",
  "sup",
  "sub",
  "u",
  "s",
  "small",
  "big",
];

const COMMON_ATTRS = [
  "style",
  "class",
  "align",
  "valign",
  "width",
  "height",
  "bgcolor",
  "background",
  "border",
  "cellpadding",
  "cellspacing",
  "colspan",
  "rowspan",
  "dir",
  "lang",
  "role",
  "title",
  "color",
  "face",
  "size",
];

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/** Unwrap known redirect wrappers and strip utm_* params. Leaves opaque redirects alone. */
export function cleanLink(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return href;

  for (let depth = 0; depth < 3; depth++) {
    const host = url.hostname.toLowerCase();
    const wrapper = REDIRECT_PARAMS.find((r) => r.host.test(host));
    const target = wrapper ? url.searchParams.get(wrapper.param) : null;
    if (!target || !/^https?:\/\//i.test(target)) break;
    try {
      url = new URL(target);
    } catch {
      break;
    }
  }

  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

function isTrackingPixel(attribs: Record<string, string>): boolean {
  const dim = (v: string | undefined) => (v === undefined ? undefined : parseInt(v, 10));
  const w = dim(attribs.width);
  const h = dim(attribs.height);
  if ((w !== undefined && w <= 3) || (h !== undefined && h <= 3)) return true;

  const style = (attribs.style ?? "").replace(/\s+/g, "").toLowerCase();
  if (/display:none|visibility:hidden|(^|;)(width|height):[0-3]px/.test(style)) return true;

  const url = attribs.src ? parseUrl(attribs.src) : undefined;
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  if (TRACKER_HOSTS.some((re) => re.test(host))) return true;
  if (TRACKER_PATHS.some((re) => re.test(url.pathname))) return true;
  // Mailgun-style open pixels: email.<sender-domain>/o/<token>
  return host.startsWith("email.") && url.pathname.startsWith("/o/");
}

/**
 * Sanitize newsletter HTML for display in a script-less sandboxed iframe.
 * Keeps styles (newsletters are unreadable without them); removes anything executable,
 * tracking pixels, and recoverable redirect wrappers.
 */
export function sanitizeNewsletterHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowVulnerableTags: true, // for <style>; the iframe has no script execution
    nonTextTags: ["script", "textarea", "option", "noscript", "title"],
    allowedAttributes: {
      "*": COMMON_ATTRS,
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height", "srcset"],
      source: ["srcset", "media", "type"],
      td: [...COMMON_ATTRS, "nowrap"],
      th: [...COMMON_ATTRS, "nowrap"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    // cid: (inline attachments) is not stored, so those images are dropped entirely below.
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    allowProtocolRelative: false,
    exclusiveFilter: (frame) =>
      frame.tag === "img" && (!frame.attribs.src || isTrackingPixel(frame.attribs)),
    transformTags: {
      a: (tagName, attribs) => {
        const out: Record<string, string> = {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        };
        if (attribs.href) out.href = cleanLink(attribs.href);
        return { tagName, attribs: out };
      },
    },
  });
}
