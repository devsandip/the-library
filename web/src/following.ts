/**
 * Followed stories (#22) as the app holds them: the Following list, read once and kept for the
 * page's life, so a story sheet knows whether its story is followed without asking, and Library
 * shows how many points are new. Following and unfollowing change it at once; Following itself
 * reads it again when opened, since the check after an ingest may have added points.
 */
import { useEffect, useState } from "preact/hooks";
import { storyRef } from "@library/core/stories";
import type { Follow, FollowingResponse } from "@library/core/types";
import type { LibraryApi } from "./api.js";
import { useApp } from "./context.js";

export type FollowingState =
  | { status: "loading" }
  | { status: "ok"; data: FollowingResponse }
  | { status: "error"; error: string };

let state: FollowingState = { status: "loading" };
let reading: Promise<void> | undefined;
/** Stories being followed or unfollowed now, by story ref. */
const busy = new Set<string>();
const listeners = new Set<() => void>();

function put(next: FollowingState) {
  state = next;
  for (const l of listeners) l();
}

const total = (items: Follow[]) => items.reduce((sum, f) => sum + f.unseen, 0);

export const followingState = () => state;

/** Reads the list again; what is on screen stays meanwhile. */
export function readFollowing(api: LibraryApi): Promise<void> {
  reading ??= api
    .following()
    .then(
      (data) => put({ status: "ok", data }),
      (err: Error) => {
        if (state.status !== "ok") put({ status: "error", error: err.message });
      },
    )
    .finally(() => (reading = undefined));
  return reading;
}

/** The list, read the first time any view asks for it. */
export function useFollowing(): { state: FollowingState; reload: () => Promise<void> } {
  const { api } = useApp();
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((t) => t + 1);
    listeners.add(l);
    if (state.status === "loading") void readFollowing(api);
    return () => void listeners.delete(l);
  }, []);
  return { state, reload: () => readFollowing(api) };
}

/** The follow a story belongs to, if it is followed. */
export function followOf(id: string, n: number): Follow | undefined {
  if (state.status !== "ok") return undefined;
  const ref = storyRef(id, n);
  return state.data.items.find((f) => f.stories.includes(ref));
}

export const followBusy = (id: string, n: number) => busy.has(storyRef(id, n));

function withItems(items: Follow[]) {
  if (state.status !== "ok") return;
  put({ status: "ok", data: { items, unseen: total(items) } });
}

/** Follows the story, or unfollows it if it is followed. Throws the API's error. */
export async function toggleFollow(api: LibraryApi, id: string, n: number): Promise<boolean> {
  const ref = storyRef(id, n);
  if (busy.has(ref)) return followOf(id, n) !== undefined;
  busy.add(ref);
  put(state);
  try {
    if (state.status !== "ok") await readFollowing(api);
    const was = followOf(id, n);
    if (was) {
      await api.unfollow(id, n);
      if (state.status === "ok") withItems(state.data.items.filter((f) => f !== was));
      return false;
    }
    const f = await api.follow(id, n);
    if (state.status === "ok") {
      withItems([f, ...state.data.items.filter((x) => x.eventId !== f.eventId)]);
    }
    return true;
  } finally {
    busy.delete(ref);
    put(state);
  }
}

/** Unfollows a followed story from Following. */
export async function unfollow(api: LibraryApi, f: Follow): Promise<void> {
  await api.unfollow(f.issueId, f.n);
  if (state.status === "ok") withItems(state.data.items.filter((x) => x.eventId !== f.eventId));
}

/** Marks every new point seen: the count clears; the page keeps its own note of what was new. */
export async function markSeen(api: LibraryApi): Promise<void> {
  if (state.status !== "ok" || !state.data.unseen) return;
  await api.seenFollowing();
  if (state.status === "ok") withItems(state.data.items.map((f) => ({ ...f, unseen: 0 })));
}

/**
 * The points new on a follow: the `unseen` most recently added. Every point added after Sandip
 * last looked is newer than every point added before, so the newest few are the new ones.
 */
export function newPoints(f: Follow): Set<number> {
  const added = f.points
    .map((p, k) => ({ k, added: p.added }))
    .filter((p): p is { k: number; added: string } => p.added !== undefined)
    .sort((a, b) => b.added.localeCompare(a.added));
  return new Set(added.slice(0, f.unseen).map((p) => p.k));
}

/** A story's follow, whether it is being changed, and following or unfollowing it. */
export function useFollow(id: string, n: number) {
  const { api } = useApp();
  const { state: s } = useFollowing();
  return {
    ready: s.status === "ok",
    followed: followOf(id, n) !== undefined,
    busy: followBusy(id, n),
    toggle: () => toggleFollow(api, id, n),
  };
}

/** For tests: forget the list. */
export function resetFollowing() {
  state = { status: "loading" };
  reading = undefined;
  busy.clear();
}
