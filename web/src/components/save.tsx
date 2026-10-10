import type { IssueListItem } from "@library/core/types";
import { useApp } from "../context.js";
import { useLibrary } from "../library.js";
import { BookmarkIcon } from "./icons.js";

/**
 * Save for later (#43) from a list. The bookmark flips at once, and back if the save fails. The
 * row stays where it is until the list loads again, so nothing moves under the pointer.
 */
export function useSaveToggle(patch: (id: string, change: Partial<IssueListItem>) => void) {
  const { api } = useApp();
  const { counts } = useLibrary();
  return (issue: IssueListItem) => {
    const saved = issue.savedAt === undefined;
    patch(issue.id, { savedAt: saved ? new Date().toISOString() : undefined });
    void api.setSaved(issue.id, saved).then(
      // Saving takes an unread issue out of Unread, so the numbers move.
      () => counts.reload(),
      () => patch(issue.id, { savedAt: issue.savedAt }),
    );
  };
}

/** The bookmark on a row or a card; filled means saved. Archived issues cannot be saved. */
export function SaveButton({
  issue,
  onSave,
}: {
  issue: IssueListItem;
  onSave: (issue: IssueListItem) => void;
}) {
  if (issue.state === "archived") return null;
  const saved = issue.savedAt !== undefined;
  return (
    <button
      type="button"
      class={`save-toggle${saved ? " on" : ""}`}
      aria-pressed={saved}
      aria-label="Save for later"
      title={saved ? "Saved for later" : "Save for later"}
      onClick={() => onSave(issue)}
    >
      <BookmarkIcon filled={saved} />
    </button>
  );
}
