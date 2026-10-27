import type {
  IssueListItem,
  IssueStoriesResponse,
  IssueStory,
  RelatedItem,
  RelatedResponse,
  SenderListItem,
  Shelf,
  UnreadCountsResponse,
} from "@library/core/types";
import type { LibraryApi } from "./api.js";
import { facets, type Facets } from "./counts.js";
import { useApp } from "./context.js";
import { useEffect } from "preact/hooks";
import { useAsync } from "./hooks.js";

/**
 * An issue's stories and its related stories change only when the issue is split again, so they
 * are read once per issue per page load and shared by the deck, the peek, the story sheet and the
 * Mac's story index.
 */
const stories = new Map<string, Promise<IssueStoriesResponse>>();
const related = new Map<string, Promise<RelatedResponse>>();

function once<T>(cache: Map<string, Promise<T>>, id: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(id);
  if (!p) {
    p = load();
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return p;
}

export const storiesOf = (api: LibraryApi, id: string) => once(stories, id, () => api.stories(id));

type StoryPatch = (id: string, n: number, change: Partial<IssueStory>) => void;
const storyViews = new Set<StoryPatch>();
const patched = (r: IssueStoriesResponse, n: number, change: Partial<IssueStory>) => ({
  stories: r.stories.map((s) => (s.n === n ? { ...s, ...change } : s)),
});

/**
 * A story changed here (#81: read, archived, moved): the shared copy and every view showing the
 * issue's stories follow.
 */
export function patchStory(id: string, n: number, change: Partial<IssueStory>) {
  const p = stories.get(id);
  if (p)
    stories.set(
      id,
      p.then((r) => patched(r, n, change)),
    );
  for (const view of storyViews) view(id, n, change);
}
export const relatedOf = (api: LibraryApi, id: string) => once(related, id, () => api.related(id));

export function useStories(id: string | undefined) {
  const { api } = useApp();
  const list = useAsync(
    () => (id ? storiesOf(api, id) : Promise.resolve({ stories: [] })),
    [id],
    id ? `stories:${id}` : undefined,
  );
  useEffect(() => {
    const view: StoryPatch = (sid, n, change) => {
      if (sid === id) list.set((r) => patched(r, n, change));
    };
    storyViews.add(view);
    return () => void storyViews.delete(view);
  }, [id]);
  return list;
}

export function useRelated(id: string | undefined) {
  const { api } = useApp();
  return useAsync(
    (): Promise<RelatedResponse> =>
      id ? relatedOf(api, id) : Promise.resolve({ earlier: [], since: [] }),
    [id],
    id ? `related:${id}` : undefined,
  );
}

/** One story's relatives: a digest has them per story; a single-story issue, for the whole issue. */
export function storyRelated(r: RelatedResponse | undefined, n: number, digest: boolean) {
  if (!r) return { earlier: [] as RelatedItem[], since: [] as RelatedItem[] };
  if (!digest || !r.stories) return { earlier: r.earlier, since: r.since };
  const s = r.stories.find((x) => x.n === n);
  return { earlier: s?.earlier ?? [], since: s?.since ?? [] };
}

/** "Platformer, The Ken": the other newsletters a story also appeared in. */
export function alsoIn(items: RelatedItem[], self: string): string[] {
  const names: string[] = [];
  for (const i of items) {
    if (i.publication !== self && !names.includes(i.publication)) names.push(i.publication);
  }
  return names;
}

/**
 * The unread tally for one shelf and its filters; muted senders are left out unless picked.
 * News counts issues, Learning counts stories (#81).
 */
export function tally(
  counts: UnreadCountsResponse | undefined,
  senders: SenderListItem[],
  f: { shelf?: Shelf; topics: string[]; senders: string[] },
): Facets | undefined {
  if (!counts) return undefined;
  const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
  const news = counts.counts.filter((c) => (c.shelf ?? "news") === "news");
  return facets([...news, ...counts.learning], f, muted);
}

/** One issue's fields replaced, for lists that follow what a view changes. */
export function patchIssue<T extends { id: string }>(
  items: T[],
  id: string,
  patch: Partial<NoInfer<T>>,
): T[] {
  return items.map((i) => (i.id === id ? { ...i, ...patch } : i));
}

/** Whether an issue has been dealt with from Today's point of view. */
export const handled = (i: IssueListItem) =>
  i.rating !== undefined || i.savedAt !== undefined || i.state !== "unread";
