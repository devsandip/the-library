import { useEffect, useRef } from "preact/hooks";
import type {
  IssueStory,
  LearningItem,
  LearningListResponse,
  Shelf,
  StoryState,
} from "@library/core/types";
import type { IssueChange } from "./actions.js";
import { useApp } from "./context.js";
import { patchStory } from "./data.js";
import { useLibrary } from "./library.js";
import { useList } from "./list.js";
import { useToast } from "./components/toast.js";

/** A row of Learning (#81): a story and its issue, under one id for the list. */
export interface LearningRow extends LearningItem {
  id: string;
}

export const learningRowId = (issueId: string, n: number) => `${issueId}#${n}`;

const toRow = (i: LearningItem): LearningRow => ({
  ...i,
  id: learningRowId(i.issue.id, i.story.n),
});

/** What a story's own controls change. Unread is the absence of a state, as the API sends it. */
export interface StoryChange {
  state?: StoryState;
  shelf?: Shelf;
}

/** The story as it reads after a change: unread drops the state. */
export function changed(story: IssueStory, c: StoryChange): IssueStory {
  const { state: _state, ...rest } = story;
  const state = "state" in c ? c.state : story.state;
  return {
    ...rest,
    ...(state && state !== "unread" ? { state } : {}),
    ...(c.shelf ? { shelf: c.shelf } : {}),
  };
}

/** A change to a Learning row: to its story, or to its issue (a thumb, Save) from the reader. */
export type LearningChange = StoryChange & { issue?: IssueChange };

const patchRows = (rows: LearningRow[], id: string, c: LearningChange) =>
  rows.map((r) =>
    r.id === id
      ? { ...r, story: changed(r.story, c), issue: c.issue ? { ...r.issue, ...c.issue } : r.issue }
      : r,
  );

/** Learning's list (#81), with its rows held in place like the issue lists. */
export function useLearningList(
  key: string,
  load: (cursor?: string) => Promise<LearningListResponse>,
) {
  return useList<LearningRow, LearningChange>(
    key ? `learning:${key}` : "",
    (cursor) => load(cursor).then((r) => ({ items: r.items.map(toRow), cursor: r.cursor })),
    patchRows,
  );
}

/**
 * What can be done to a story itself (#81), from Learning, the story sheet and the Mac's keys.
 * Each change shows at once, goes to the API, comes back if the API refuses it, and archive and
 * move offer Undo. Rating and saving stay with the issue.
 */
export interface StoryActions {
  /** A Learning story was viewed: it is read. Quiet, and only once. */
  read: (issueId: string, story: IssueStory) => void;
  /** Archive, or bring it back to Learning as read. */
  archive: (issueId: string, story: IssueStory) => void;
  /** Move to the other shelf: Sandip's call, which Jev never undoes. */
  move: (issueId: string, story: IssueStory) => void;
}

export function useStoryActions(
  onChange?: (issueId: string, n: number, change: StoryChange) => void,
): StoryActions {
  const { api } = useApp();
  const { counts } = useLibrary();
  const toast = useToast();
  const latest = useRef(onChange);
  latest.current = onChange;

  const show = (issueId: string, n: number, c: StoryChange) => {
    patchStory(issueId, n, {
      ...(c.shelf ? { shelf: c.shelf } : {}),
      ...("state" in c ? { state: c.state === "unread" ? undefined : c.state } : {}),
    });
    latest.current?.(issueId, n, c);
  };

  const apply = (issueId: string, story: IssueStory, c: StoryChange, text?: string) => {
    const back: StoryChange = {
      ...("state" in c ? { state: story.state ?? "unread" } : {}),
      ...("shelf" in c ? { shelf: story.shelf ?? "news" } : {}),
    };
    show(issueId, story.n, c);
    const send = (x: StoryChange) => api.setStory(issueId, story.n, x).then(() => counts.reload());
    const sent = send(c).then(
      () => true,
      (err: Error) => {
        show(issueId, story.n, back);
        toast.say(`Not saved: ${err.message}`);
        return false;
      },
    );
    if (!text) return;
    toast.say(text, {
      label: "Undo",
      run: () => {
        show(issueId, story.n, back);
        void sent.then(async (ok) => {
          if (!ok) return;
          try {
            await send(back);
          } catch (err) {
            show(issueId, story.n, c);
            toast.say(`Undo failed: ${(err as Error).message}`);
          }
        });
      },
    });
  };

  return {
    read: (issueId, story) => {
      if (story.shelf === "learning" && story.state === undefined) {
        apply(issueId, story, { state: "read" });
      }
    },
    archive: (issueId, story) => {
      const archiving = story.state !== "archived";
      apply(
        issueId,
        story,
        { state: archiving ? "archived" : "read" },
        archiving ? "Story archived" : "Back in Learning",
      );
    },
    move: (issueId, story) => {
      const to: Shelf = story.shelf === "learning" ? "news" : "learning";
      apply(issueId, story, { shelf: to }, `Story moved to ${to === "news" ? "News" : "Learning"}`);
    },
  };
}

/**
 * Viewing a Learning story marks it read (#81), once per story while the view is open. Its issue
 * keeps its own state.
 */
export function useStoryRead(
  issueId: string | undefined,
  story: IssueStory | undefined,
  actions: StoryActions,
) {
  const done = useRef(new Set<string>());
  useEffect(() => {
    if (!issueId || story?.shelf !== "learning" || story.state !== undefined) return;
    const id = learningRowId(issueId, story.n);
    if (done.current.has(id)) return;
    done.current.add(id);
    actions.read(issueId, story);
  }, [issueId, story?.n, story?.shelf]);
}
