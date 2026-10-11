import type { IssueListItem, Shelf } from "@library/core/types";
import { useApp } from "./context.js";
import { swipeChange, undoOf, type SwipeChange } from "./gesture.js";
import { useLibrary } from "./library.js";
import { useToast } from "./components/toast.js";

export type IssueChange = SwipeChange & Partial<Pick<IssueListItem, "shelf">>;

/**
 * What a reader can do to an issue from any view: the deck, a row, the reader, the Mac's keys.
 * Each change shows at once, goes to the API, comes back if the API refuses it, and offers Undo
 * where the copy says so. Undo puts back the rating, the archive state and the saved state
 * together (business rules 3 and 4).
 */
export interface IssueActions {
  /** Relevant; again clears it. The issue stays unread. */
  relevant: (issue: IssueListItem, opts?: { quiet?: boolean }) => void;
  /** Irrelevant and archived (which also unsaves); again puts both back. */
  irrelevant: (issue: IssueListItem) => void;
  /** Save for later, or take it off Saved. Saving takes an issue out of Unread. */
  save: (issue: IssueListItem) => void;
  /** Archive, or bring it back to the inbox as read. */
  archive: (issue: IssueListItem) => void;
  /** Move to the other shelf: News or Learning. */
  move: (issue: IssueListItem) => void;
}

export function useIssueActions(opts: {
  /** Shows a change on screen (and puts it back). */
  patch: (id: string, change: IssueChange) => void;
  /** On lists that leave archived issues out: hide the row, or bring it back on Undo. */
  hide?: (id: string, gone: boolean) => void;
}): IssueActions {
  const { api } = useApp();
  const { counts, nowReading } = useLibrary();
  const toast = useToast();

  const send = async (id: string, c: IssueChange) => {
    await Promise.all([
      "rating" in c ? api.rate(id, c.rating ?? 0) : undefined,
      c.state ? api.setState(id, c.state) : undefined,
    ]);
    // The API unsaves an issue as it archives it; Undo saves again once it is out of the archive.
    if ("savedAt" in c && c.state !== "archived") await api.setSaved(id, c.savedAt !== undefined);
    if (c.shelf) await api.setShelf(id, c.shelf);
    if ("state" in c || "savedAt" in c || "shelf" in c) counts.reload();
    // Rating or archiving an issue ends Now reading on it (rule 19).
    if ("state" in c || "rating" in c) nowReading.reload();
  };

  const show = (issue: IssueListItem, c: IssueChange, gone: boolean) => {
    opts.patch(issue.id, c);
    if (opts.hide && "state" in c) opts.hide(issue.id, gone);
  };

  /** Apply a change; with `text`, say so, and with `undoable`, offer Undo. */
  const apply = (issue: IssueListItem, c: IssueChange, text?: string, undoable = true) => {
    const back: IssueChange = {
      ...undoOf(issue, c),
      ...("shelf" in c ? { shelf: issue.shelf } : {}),
    };
    show(issue, c, c.state === "archived");
    const sent = send(issue.id, c).then(
      () => true,
      (err: Error) => {
        show(issue, back, false);
        toast.say(`Not saved: ${err.message}`);
        return false;
      },
    );
    if (!text) return;
    toast.say(
      text,
      undoable
        ? {
            label: "Undo",
            run: () => {
              show(issue, back, false);
              // Undo waits for the change to land, then reverses it.
              void sent.then(async (ok) => {
                if (!ok) return;
                try {
                  await send(issue.id, back);
                } catch (err) {
                  show(issue, c, c.state === "archived");
                  toast.say(`Undo failed: ${(err as Error).message}`);
                }
              });
            },
          }
        : undefined,
    );
  };

  return {
    relevant: (issue, o) => {
      if (issue.rating === 1) {
        apply(issue, { rating: undefined });
        return;
      }
      const c = swipeChange(issue, "right")!;
      const text = o?.quiet
        ? undefined
        : issue.state === "unread"
          ? "Relevant · it stays unread"
          : "Relevant";
      apply(issue, c, text, false);
    },
    irrelevant: (issue) => {
      const c = swipeChange(issue, "left");
      if (!c) {
        // Already Irrelevant and archived: the button again takes both back.
        apply(issue, { rating: undefined, state: "read" }, "Back in the inbox");
        return;
      }
      apply(issue, c, c.state ? "Irrelevant · archived" : "Irrelevant");
    },
    save: (issue) => {
      if (issue.state === "archived") return;
      const saving = issue.savedAt === undefined;
      apply(
        issue,
        { savedAt: saving ? new Date().toISOString() : undefined },
        saving ? "Saved for later" : "Taken off Saved",
      );
    },
    archive: (issue) => {
      const archiving = issue.state !== "archived";
      apply(
        issue,
        archiving
          ? { state: "archived", ...(issue.savedAt !== undefined ? { savedAt: undefined } : {}) }
          : { state: "read" },
        archiving ? "Archived" : "Back in the inbox",
      );
    },
    move: (issue) => {
      const to: Shelf = (issue.shelf ?? "news") === "news" ? "learning" : "news";
      apply(issue, { shelf: to }, `Moved to ${to === "news" ? "News" : "Learning"}`);
    },
  };
}
