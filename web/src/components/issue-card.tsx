import type { IssueListItem } from "@library/core/types";
import { issueHref } from "../filters.js";
import { relativeTime } from "../format.js";
import { StarIcon, ThumbDown, ThumbUp } from "./icons.js";

/**
 * A briefing card on the phone (#12): Claude's one line first, then where it came from. A lead
 * card (the Must Read row) also names the newsletter up top and keeps the headline.
 */
export function IssueCard({
  issue,
  lead = false,
  showPublication = true,
}: {
  issue: IssueListItem;
  lead?: boolean;
  showPublication?: boolean;
}) {
  const unread = issue.state === "unread";
  return (
    <li class={`issue-card${lead ? " lead" : ""}${unread ? " unread" : ""}`}>
      <a href={issueHref(issue.id)}>
        {lead && <span class="card-pub">{issue.publication}</span>}
        <span class="card-line">{issue.summary ?? issue.subject}</span>
        {lead && issue.summary && <span class="card-title">{issue.subject}</span>}
        <span class="card-meta">
          {!unread && <span class="sr-only">Read. </span>}
          {!lead && showPublication && (
            <>
              {issue.publication}
              {issue.mustRead && (
                <span class="star" title="Must Read">
                  <StarIcon filled />
                  <span class="sr-only">Must Read</span>
                </span>
              )}
              {" · "}
            </>
          )}
          <time dateTime={issue.receivedAt}>{relativeTime(issue.receivedAt)}</time>
          {` · ${issue.readMinutes} min`}
          {(lead || !showPublication) && issue.topic && ` · ${issue.topic}`}
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
        </span>
      </a>
    </li>
  );
}
