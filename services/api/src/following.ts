/**
 * Follow a story (#22), the API's half: follow a story's event, list what is followed, unfollow,
 * and mark it all seen. A story is followed with its event's kept timeline (#19) when there is
 * one, otherwise with the story itself as one dated point. The moves are added by the check after
 * each ingest (services/ingest/src/follow.ts), never here.
 */
import { FOLLOW_LIMIT, followOrder, followView, type StoredFollow } from "@library/core";
import type { Follow, FollowingResponse, FollowPoint, Timeline } from "@library/core/types";
import { HttpError, notFound } from "./errors.js";
import type { FollowPort } from "./port.js";
import type { TimelineStory } from "./timeline.js";

/** Where followed stories are kept. DynamoRepo implements it; tests use a fake. */
export interface FollowStore {
  timelineStory(id: string, n: number): Promise<TimelineStory | undefined>;
  getTimeline(eventId: string): Promise<Timeline | undefined>;
  listFollows(): Promise<StoredFollow[]>;
  /** Keeps a new follow; false when its event was followed in the meantime. */
  addFollow(follow: StoredFollow): Promise<boolean>;
  deleteFollow(eventId: string): Promise<void>;
  /** Marks a follow seen, if it is still followed. */
  seeFollow(eventId: string, at: string): Promise<void>;
}

/** The point a story is followed with when its event has no kept timeline: the story itself. */
export function storyPoint(story: TimelineStory): FollowPoint {
  return {
    at: story.receivedAt,
    text: story.summary || story.headline,
    sources: [
      {
        issueId: story.issueId,
        publication: story.publication,
        ...(story.digest ? { story: { n: story.n, headline: story.headline } } : {}),
      },
    ],
    current: true,
  };
}

export class Following implements FollowPort {
  constructor(
    private readonly store: FollowStore,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<FollowingResponse> {
    const now = this.now();
    const items = (await this.store.listFollows()).map((f) => followView(f, now)).sort(followOrder);
    return { items, unseen: items.reduce((sum, f) => sum + f.unseen, 0) };
  }

  async follow(id: string, n: number): Promise<Follow> {
    const story = await this.story(id, n);
    const follows = await this.store.listFollows();
    const already = follows.find((f) => f.eventId === story.eventId);
    if (already) return followView(already, this.now());
    if (follows.length >= FOLLOW_LIMIT) {
      throw new HttpError(409, `You follow ${FOLLOW_LIMIT} stories. Unfollow one first.`);
    }
    const timeline = await this.store.getTimeline(story.eventId);
    const at = new Date(this.now()).toISOString();
    const follow: StoredFollow = {
      eventId: story.eventId,
      issueId: id,
      n,
      headline: story.headline,
      publication: story.publication,
      followedAt: at,
      seenAt: at,
      points: timeline?.points.length ? timeline.points : [storyPoint(story)],
      checked: [],
    };
    if (!(await this.store.addFollow(follow))) {
      // Followed from another device in between: that follow stands.
      const other = (await this.store.listFollows()).find((f) => f.eventId === story.eventId);
      if (other) return followView(other, this.now());
    }
    return followView(follow, this.now());
  }

  /** Unfollows the story's event, and any follow of the story a relink has left on another. */
  async unfollow(id: string, n: number): Promise<void> {
    const story = await this.story(id, n);
    const follows = await this.store.listFollows();
    await Promise.all(
      follows
        .filter((f) => f.eventId === story.eventId || (f.issueId === id && f.n === n))
        .map((f) => this.store.deleteFollow(f.eventId)),
    );
  }

  async seen(): Promise<void> {
    const now = this.now();
    const at = new Date(now).toISOString();
    const follows = await this.store.listFollows();
    await Promise.all(
      follows
        .filter((f) => followView(f, now).unseen > 0)
        .map((f) => this.store.seeFollow(f.eventId, at)),
    );
  }

  private async story(id: string, n: number): Promise<TimelineStory> {
    const story = await this.store.timelineStory(id, n);
    if (!story) throw notFound(`issue ${id} has no story ${n}`);
    return story;
  }
}
