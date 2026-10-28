/**
 * Story shelves (#81): which shelf a story is on, what that makes its issue, and where an unread
 * Learning story is indexed. Pure, so ingest, the API and the tests share one set of rules.
 */
import { PARTITION } from "./keys.js";
import { storyRef } from "./stories.js";
import type { Shelf, StoryShelfSetBy, StoryState } from "./types.js";

/** Learning from this probability of Jev's up. */
export const LEARNING_FROM = 0.5;

export const shelfFor = (learning: number): Shelf =>
  learning >= LEARNING_FROM ? "learning" : "news";

/** Unsure answers. They are shelved by 0.5 like the rest; the stored probability finds them later. */
export const UNSURE = { from: 0.4, to: 0.6 } as const;

export const isUnsure = (p: number) => p >= UNSURE.from && p < UNSURE.to;

/** A story's shelf fields as stored. `learning` is Jev's probability, once Jev has read it. */
export interface StoryShelfFields {
  shelf?: Shelf;
  shelfSetBy?: StoryShelfSetBy;
  learning?: number;
}

/**
 * A story's effective shelf: Sandip's move, then its newsletter's "always" setting, then Jev.
 * Empty until one of them has decided.
 */
export function storyShelf(
  s: StoryShelfFields,
  senderShelf?: Shelf,
): { shelf?: Shelf; shelfSetBy?: StoryShelfSetBy } {
  if (s.shelfSetBy === "sandip" && s.shelf) return { shelf: s.shelf, shelfSetBy: "sandip" };
  if (senderShelf) return { shelf: senderShelf, shelfSetBy: "sender" };
  if (s.learning !== undefined) return { shelf: shelfFor(s.learning), shelfSetBy: "jev" };
  return {};
}

/**
 * An issue's shelf from its stories' shelves: Learning when every story is Learning, News as soon
 * as one is News or not shelved yet. Undefined for an issue with no stories, which keeps its own.
 */
export function issueShelf(stories: (Shelf | undefined)[]): Shelf | undefined {
  if (!stories.length) return undefined;
  return stories.every((s) => s === "learning") ? "learning" : "news";
}

const STORY_INDEX_ATTRS = ["gsi2pk", "gsi2sk"] as const;
export type StoryIndexAttr = (typeof STORY_INDEX_ATTRS)[number];

/**
 * The index attributes a story should carry beyond `gsi1` (where every story sits): an unread
 * Learning story is in `gsi2` under `LEARNING`, newest last, so Learning lists and counts them
 * without reading every story. Attributes in `remove` go in the same write.
 */
export function storyIndexAttributes(story: {
  issueId: string;
  n: number;
  receivedAt: string;
  shelf?: Shelf;
  state?: StoryState;
}): { set: Partial<Record<StoryIndexAttr, string>>; remove: StoryIndexAttr[] } {
  const set: Partial<Record<StoryIndexAttr, string>> = {};
  if (story.shelf === "learning" && (story.state ?? "unread") === "unread") {
    set.gsi2pk = PARTITION.learning;
    set.gsi2sk = `${story.receivedAt}#${storyRef(story.issueId, story.n)}`;
  }
  return { set, remove: STORY_INDEX_ATTRS.filter((a) => !(a in set)) };
}
