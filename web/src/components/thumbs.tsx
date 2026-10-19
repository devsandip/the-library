import type { IssueListItem } from "@library/core/types";
import type { IssueActions } from "../actions.js";
import { ThumbIcon } from "./icons.js";

/** Thumbs up and down: was it useful? Each again takes it back. */
export function Thumbs({
  issue,
  actions,
  class: cls,
}: {
  issue: IssueListItem;
  actions: IssueActions;
  class: string;
}) {
  return (
    <>
      <button
        type="button"
        class={`${cls}${issue.rating === 1 ? " on rel" : ""}`}
        aria-pressed={issue.rating === 1}
        aria-label="Useful"
        title="Useful"
        onClick={() => actions.useful(issue, { quiet: true })}
      >
        <ThumbIcon />
      </button>
      <button
        type="button"
        class={`${cls}${issue.rating === -1 ? " on irr" : ""}`}
        aria-pressed={issue.rating === -1}
        aria-label="Not useful"
        title="Not useful"
        onClick={() => actions.notUseful(issue, { quiet: true })}
      >
        <ThumbIcon down />
      </button>
    </>
  );
}
