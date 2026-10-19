import type { IssueListItem, Rating, Shelf } from "@library/core/types";
import { useApp } from "./context.js";
import { useLibrary } from "./library.js";
import { useToast } from "./components/toast.js";

export type IssueChange = Partial<Pick<IssueListItem, "rating" | "state" | "savedAt" | "shelf">>;

/** The fields to put back so a change is undone (rule 4: rating, archive and saved together). */
export function undoOf(issue: IssueListItem, change: IssueChange): IssueChange {
  return {
    ...("rating" in change ? { rating: issue.rating } : {}),
    ...("state" in change ? { state: issue.state } : {}),
    ...("savedAt" in change ? { savedAt: issue.savedAt } : {}),
    ...("shelf" in change ? { shelf: issue.shelf } : {}),
  };
}

/**
 * What a reader can do to an issue from any view: the deck, the reader, the Mac's keys. Each
 * change shows at once, goes to the API, comes back if the API refuses it, and offers Undo where
 * the copy says so. Undo puts back the rating, the archive state and the saved state together
 * (business rules 3 and 4).
 */
export interface IssueActions {
  /** Thumbs up: it was useful. Again clears it. Nothing else changes: it stays unread. */
  useful: (issue: IssueListItem, opts?: { quiet?: boolean }) => void;
  /** Thumbs down: it was not useful. Again clears it. It is not archived. */
  notUseful: (issue: IssueListItem, opts?: { quiet?: boolean }) => void;
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

  /** Apply a change; with `text`, say so, and with `undoable`, offer Undo. */
  const apply = (issue: IssueListItem, c: IssueChange, text?: string, undoable = true) => {
    const back = undoOf(issue, c);
    opts.patch(issue.id, c);
    const sent = send(issue.id, c).then(
      () => true,
      (err: Error) => {
        opts.patch(issue.id, back);
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
              opts.patch(issue.id, back);
              // Undo waits for the change to land, then reverses it.
              void sent.then(async (ok) => {
                if (!ok) return;
                try {
                  await send(issue.id, back);
                } catch (err) {
                  opts.patch(issue.id, c);
                  toast.say(`Undo failed: ${(err as Error).message}`);
                }
              });
            },
          }
        : undefined,
    );
  };

  /** A thumb sets the rating, or clears it when it is already that way. */
  const thumb = (issue: IssueListItem, value: Rating, quiet = false) => {
    const clear = issue.rating === value;
    const text = clear ? "Thumb cleared" : value === 1 ? "Useful" : "Not useful";
    apply(issue, { rating: clear ? undefined : value }, quiet ? undefined : text, false);
  };

  return {
    useful: (issue, o) => thumb(issue, 1, o?.quiet),
    notUseful: (issue, o) => thumb(issue, -1, o?.quiet),
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
