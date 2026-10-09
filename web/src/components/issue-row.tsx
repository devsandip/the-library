import type { IssueListItem } from "@library/core/types";
import { BASE } from "../config.js";
import { relativeTime } from "../format.js";
import { ThumbDown, ThumbUp } from "./icons.js";

export function IssueRow({
  issue,
  showPublication = true,
}: {
  issue: IssueListItem;
  showPublication?: boolean;
}) {
  const unread = issue.state === "unread";
  const preview = issue.summary ?? issue.snippet;
  return (
    <li class={`issue-row${unread ? " unread" : ""}`}>
      <a href={`${BASE}/issue/${encodeURIComponent(issue.id)}`}>
        {showPublication && (
          <span class="publication">
            {unread && <span class="dot" aria-label="Unread" />}
            {issue.publication}
          </span>
        )}
        <span class="subject">{issue.subject}</span>
        {preview && <span class="snippet">{preview}</span>}
        <span class="meta">
          <time dateTime={issue.receivedAt}>{relativeTime(issue.receivedAt)}</time>
          <span aria-hidden="true">·</span>
          <span>{issue.readMinutes} min</span>
          {issue.rating === 1 && (
            <span class="rated up" title="Relevant">
              <ThumbUp filled />
            </span>
          )}
          {issue.rating === -1 && (
            <span class="rated down" title="Irrelevant">
              <ThumbDown filled />
            </span>
          )}
        </span>
      </a>
    </li>
  );
}
