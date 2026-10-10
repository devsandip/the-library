import type { IssueListItem } from "@library/core/types";
import { issueHref } from "../filters.js";
import { relativeTime } from "../format.js";
import { clickInPlace } from "../nav.js";
import { StarIcon, ThumbDown, ThumbUp } from "./icons.js";

/** A row in the Mac's list column (#12): newsletter and time, the headline, Claude's line. */
export function IssueRow({
  issue,
  showPublication = true,
  selected = false,
  onOpen,
}: {
  issue: IssueListItem;
  showPublication?: boolean;
  /** Showing in the reading pane. */
  selected?: boolean;
  /** Open in the reading pane instead of on its own page. */
  onOpen?: (id: string) => void;
}) {
  const unread = issue.state === "unread";
  const preview = issue.summary ?? issue.snippet;
  return (
    <li class={`issue-row${unread ? " unread" : ""}${selected ? " selected" : ""}`}>
      <a
        class="row-link"
        href={issueHref(issue.id)}
        aria-current={selected ? "true" : undefined}
        onClick={(e) => {
          if (onOpen) clickInPlace(e, () => onOpen(issue.id));
        }}
      >
        <span class="row-top">
          <span class="row-pub">
            {unread && (
              <>
                <span class="dot" aria-hidden="true" />
                <span class="sr-only">Unread. </span>
              </>
            )}
            <span class="row-name">{showPublication ? issue.publication : issue.topic}</span>
            {showPublication && issue.mustRead && (
              <span class="star" title="Must Read">
                <StarIcon filled />
                <span class="sr-only">Must Read</span>
              </span>
            )}
          </span>
          <span class="row-meta">
            {issue.rating === 1 && (
              <span class="rated up" title="Relevant">
                <ThumbUp filled />
                <span class="sr-only">Rated Relevant</span>
              </span>
            )}
            {issue.rating === -1 && (
              <span class="rated down" title="Irrelevant">
                <ThumbDown filled />
                <span class="sr-only">Rated Irrelevant</span>
              </span>
            )}
            <time dateTime={issue.receivedAt}>{relativeTime(issue.receivedAt)}</time>
          </span>
        </span>
        <span class="subject">{issue.subject}</span>
        {preview && <span class="snippet">{preview}</span>}
      </a>
    </li>
  );
}
