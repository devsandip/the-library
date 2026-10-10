import type { SearchSort, Shelf, View } from "@library/core/types";
import { BASE } from "./config.js";

export const SHELVES: { id: Shelf; label: string }[] = [
  { id: "news", label: "News" },
  { id: "learning", label: "Learning" },
];

export const SHELF_LABEL: Record<Shelf, string> = { news: "News", learning: "Learning" };

export const VIEWS: { id: View; label: string }[] = [
  { id: "unread", label: "Unread" },
  { id: "all", label: "All" },
  { id: "archived", label: "Archived" },
];

/** Home's filters. They live in the URL, so Back from an issue restores them. */
export interface HomeFilters {
  shelf: Shelf;
  view: View;
  senders: string[];
  topics: string[];
  /** The issue in the reading pane (wide Mac windows). */
  issue?: string;
}

const split = (v: string | undefined) => (v ? v.split(",").filter(Boolean) : []);

export function readFilters(query: Record<string, string | undefined>): HomeFilters {
  return {
    shelf: query.shelf === "learning" ? "learning" : "news",
    view: VIEWS.find((v) => v.id === query.view)?.id ?? "unread",
    senders: split(query.sender),
    topics: split(query.topic),
    issue: query.issue || undefined,
  };
}

export function homeHref(f: HomeFilters): string {
  const q = new URLSearchParams();
  if (f.shelf !== "news") q.set("shelf", f.shelf);
  if (f.view !== "unread") q.set("view", f.view);
  if (f.senders.length) q.set("sender", f.senders.join(","));
  if (f.topics.length) q.set("topic", f.topics.join(","));
  if (f.issue) q.set("issue", f.issue);
  const qs = q.toString();
  return `${BASE}/${qs ? `?${qs}` : ""}`;
}

export const issueHref = (id: string) => `${BASE}/issue/${encodeURIComponent(id)}`;

/** Search's place (#53): the query and the order, in the URL so Back returns to the results. */
export interface SearchState {
  q: string;
  sort: SearchSort;
  /** The issue in the reading pane (wide Mac windows). */
  issue?: string;
}

export function readSearch(query: Record<string, string | undefined>): SearchState {
  return {
    q: query.q ?? "",
    sort: query.sort === "newest" ? "newest" : "best",
    issue: query.issue || undefined,
  };
}

export function searchHref(s: { q: string; sort?: SearchSort; issue?: string }): string {
  const q = new URLSearchParams();
  if (s.q) q.set("q", s.q);
  if (s.sort === "newest") q.set("sort", "newest");
  if (s.issue) q.set("issue", s.issue);
  const qs = q.toString();
  return `${BASE}/search${qs ? `?${qs}` : ""}`;
}
