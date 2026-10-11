import type { SearchSort, Shelf } from "@library/core/types";
import { BASE } from "./config.js";

/**
 * Every view is a URL (the redesign). The phone has four tabs (Today, Browse, Saved, Library);
 * the Mac has a console whose queue is News, Learning or Saved. Library's pages are shared.
 * This module turns paths into screens and back, and maps old and other-device URLs.
 */

export type Show = "unread" | "all" | "archived";
export type Order = "best" | "newest";
export type Deep = "timeline" | "backstory" | "takes" | "source";
export type QueueTab = "news" | "learning" | "saved";

export const SHOWS: Show[] = ["unread", "all", "archived"];
const DEEPS: Deep[] = ["timeline", "backstory", "takes", "source"];

/** Browse's sentence on the phone. Topics and senders are slugs (or a sender's id). */
export interface BrowseFilters {
  kind: Shelf;
  show: Show;
  topics: string[];
  senders: string[];
}

/** The Mac queue's filter line. */
export interface QueueFilters {
  show: Show;
  order: Order;
  topics: string[];
  senders: string[];
}

export type Screen =
  | { name: "today"; mode: "deck" | "list" | "brief" }
  | { name: "browse"; filters: BrowseFilters }
  | { name: "saved" }
  | { name: "library" }
  | { name: "search"; q: string; sort: SearchSort }
  | { name: "history"; day?: string }
  | { name: "newsletters" }
  | { name: "newsletter"; slug: string }
  | { name: "status" }
  | { name: "settings" }
  | { name: "issue"; id: string; story?: number; deep?: Deep }
  | {
      name: "queue";
      tab: QueueTab;
      filters: QueueFilters;
      id?: string;
      story?: number;
      deep?: Deep;
    }
  | { name: "not-found" };

type Query = Record<string, string | undefined>;

/** "AI & LLMs" -> "ai-llms", "The Ken" -> "the-ken": names as they read in a URL. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const list = (v: string | undefined) => (v ? v.split(",").filter(Boolean) : []);
const showOf = (v: string | undefined): Show => SHOWS.find((s) => s === v) ?? "unread";
const storyOf = (v: string | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
const deepOf = (v: string | undefined) => DEEPS.find((d) => d === v);

export function readBrowse(q: Query): BrowseFilters {
  return {
    kind: q.kind === "learning" ? "learning" : "news",
    show: showOf(q.show),
    topics: list(q.topic),
    senders: list(q.sender),
  };
}

export function readQueue(q: Query): QueueFilters {
  return {
    show: showOf(q.show),
    order: q.order === "newest" ? "newest" : "best",
    topics: list(q.topic),
    senders: list(q.sender),
  };
}

function queryString(pairs: [string, string | undefined][]): string {
  const q = new URLSearchParams();
  for (const [k, v] of pairs) if (v) q.set(k, v);
  // Commas read better unescaped in a URL bar, and URLSearchParams accepts them back.
  const s = q.toString().replace(/%2C/g, ",");
  return s ? `?${s}` : "";
}

export function browseHref(f: BrowseFilters): string {
  return `${BASE}/browse${queryString([
    ["kind", f.kind === "news" ? undefined : f.kind],
    ["show", f.show === "unread" ? undefined : f.show],
    ["topic", f.topics.join(",")],
    ["sender", f.senders.join(",")],
  ])}`;
}

function queueQuery(f: QueueFilters): string {
  return queryString([
    ["show", f.show === "unread" ? undefined : f.show],
    ["order", f.order === "best" ? undefined : f.order],
    ["topic", f.topics.join(",")],
    ["sender", f.senders.join(",")],
  ]);
}

const storyPath = (story?: number, deep?: Deep) =>
  story ? `/story/${story}${deep ? `/${deep}` : ""}` : "";

export const issueHref = (id: string, story?: number, deep?: Deep) =>
  `${BASE}/issue/${encodeURIComponent(id)}${storyPath(story, deep)}`;

export function queueHref(
  tab: QueueTab,
  filters: QueueFilters = DEFAULT_QUEUE,
  id?: string,
  story?: number,
  deep?: Deep,
): string {
  const issue = id ? `/${encodeURIComponent(id)}${storyPath(story, deep)}` : "";
  return `${BASE}/${tab}${issue}${queueQuery(filters)}`;
}

export const DEFAULT_QUEUE: QueueFilters = {
  show: "unread",
  order: "best",
  topics: [],
  senders: [],
};
export const DEFAULT_BROWSE: BrowseFilters = {
  kind: "news",
  show: "unread",
  topics: [],
  senders: [],
};

export const todayHref = (mode: "deck" | "list" | "brief" = "deck") =>
  `${BASE}/today${mode === "deck" ? "" : `/${mode}`}`;
export const savedHref = () => `${BASE}/saved`;
export const libraryHref = () => `${BASE}/library`;
export const searchHref = (q = "", sort: SearchSort = "best") =>
  `${BASE}/library/search${queryString([
    ["q", q],
    ["sort", sort === "best" ? undefined : sort],
  ])}`;
export const historyHref = (day?: string) =>
  `${BASE}/library/history${queryString([["day", day]])}`;
export const newslettersHref = () => `${BASE}/library/newsletters`;
export const newsletterHref = (s: string) => `${BASE}/library/newsletters/${encodeURIComponent(s)}`;
export const statusHref = () => `${BASE}/library/status`;
export const settingsHref = () => `${BASE}/library/settings`;

/** The screen a path shows, on either device. */
export function parse(path: string, q: Query): Screen {
  const rel = path.startsWith(BASE) ? path.slice(BASE.length) : path;
  const parts = rel.split("/").filter(Boolean).map(decodeURIComponent);
  const [head, a, b, c, d] = parts;
  switch (head) {
    case "today":
      if (!a) return { name: "today", mode: "deck" };
      if ((a === "list" || a === "brief") && !b) return { name: "today", mode: a };
      break;
    case "browse":
      if (!a) return { name: "browse", filters: readBrowse(q) };
      break;
    case "library":
      if (!a) return { name: "library" };
      if (b && !(a === "newsletters" && !c)) break;
      if (a === "search") return { name: "search", q: q.q ?? "", sort: sortOf(q.sort) };
      if (a === "history") return { name: "history", day: q.day || undefined };
      if (a === "newsletters") return b ? { name: "newsletter", slug: b } : { name: "newsletters" };
      if (a === "status") return { name: "status" };
      if (a === "settings") return { name: "settings" };
      break;
    case "issue": {
      if (!a) break;
      if (!b) return { name: "issue", id: a };
      const story = b === "story" ? storyOf(c) : undefined;
      if (story === undefined || (d && !deepOf(d)) || parts.length > 5) break;
      return { name: "issue", id: a, story, deep: deepOf(d) };
    }
    case "news":
    case "learning":
    case "saved": {
      const tab = head as QueueTab;
      if (!a)
        return tab === "saved" ? { name: "saved" } : { name: "queue", tab, filters: readQueue(q) };
      const story = b === "story" ? storyOf(c) : undefined;
      if (b && (story === undefined || (d && !deepOf(d)) || parts.length > 5)) break;
      return { name: "queue", tab, filters: readQueue(q), id: a, story, deep: deepOf(d) };
    }
  }
  return { name: "not-found" };
}

const sortOf = (v: string | undefined): SearchSort => (v === "newest" ? "newest" : "best");

/**
 * Where a URL should go instead, if anywhere: the pre-redesign paths (bookmarks, the home-screen
 * icon's start URL) and the other device's paths, so a URL opened on the wrong device still lands.
 */
export function redirect(path: string, q: Query, wide: boolean): string | undefined {
  const rel = path.startsWith(BASE) ? path.slice(BASE.length) : path;
  const parts = rel.split("/").filter(Boolean);
  const [head, a] = parts;

  // The old Home: /?shelf=&view=&topic=<names>&sender=<ids>&issue=
  if (!head) {
    if (q.view === "saved") return savedHref();
    const kind: Shelf = q.shelf === "learning" ? "learning" : "news";
    const show = showOf(q.view);
    const topics = list(q.topic).map(slug);
    const senders = list(q.sender);
    if (wide) {
      const filters = { show, order: "best" as const, topics, senders };
      return queueHref(kind, filters, q.issue || undefined);
    }
    if (q.issue) return issueHref(q.issue);
    const filtered = kind !== "news" || show !== "unread" || topics.length || senders.length;
    return filtered ? browseHref({ kind, show, topics, senders }) : todayHref();
  }
  if (head === "summary") {
    if (wide) return queueHref("news", DEFAULT_QUEUE, q.issue || undefined);
    return q.issue ? issueHref(q.issue) : todayHref();
  }
  if (head === "history" && !a) return historyHref(q.day);
  if (head === "search" && !a) return searchHref(q.q, sortOf(q.sort));
  if (head === "status" && !a) return statusHref();
  if (head === "senders") return a ? newsletterHref(a) : newslettersHref();
  if (head === "saved" && !a && q.issue) {
    return wide ? queueHref("saved", DEFAULT_QUEUE, q.issue) : issueHref(q.issue);
  }

  const screen = parse(path, q);
  if (wide) {
    // The Mac reaches Library's pages from ⌘K; its hub is the console.
    if (screen.name === "today" || screen.name === "library") return queueHref("news");
    if (screen.name === "browse") {
      const f = screen.filters;
      return queueHref(f.kind, {
        ...DEFAULT_QUEUE,
        show: f.show,
        topics: f.topics,
        senders: f.senders,
      });
    }
    // The console opens an issue under News until it knows the issue's shelf.
    if (screen.name === "issue") {
      return queueHref("news", DEFAULT_QUEUE, screen.id, screen.story, screen.deep);
    }
    return undefined;
  }
  if (screen.name === "queue") {
    if (screen.id) return issueHref(screen.id, screen.story, screen.deep);
    if (screen.tab === "news") return todayHref();
    const f = screen.filters;
    return browseHref({ kind: "learning", show: f.show, topics: f.topics, senders: f.senders });
  }
  return undefined;
}
