import type { IssueListItem } from "@library/core/types";
import { BASE } from "../config.js";
import { relativeTime } from "../format.js";
import { StarIcon, ThumbDown, ThumbUp } from "./icons.js";

export function IssueRow({
  issue,
  showPublication = true,
  topicHref,
}: {
  issue: IssueListItem;
  showPublication?: boolean;
  /** Where tapping the topic label goes (a filtered list); plain text when absent. */
  topicHref?: (topic: string) => string;
}) {
  const unread = issue.state === "unread";
  const preview = issue.summary ?? issue.snippet;
  return (
    <li class={`issue-row${unread ? " unread" : ""}`}>
      <a class="row-link" href={`${BASE}/issue/${encodeURIComponent(issue.id)}`}>
        {showPublication && (
          <span class="publication">
            {unread && <span class="dot" aria-label="Unread" />}
            {issue.publication}
            {issue.mustRead && (
              <span class="star" title="Must Read" aria-label="Must Read">
                <StarIcon filled />
              </span>
            )}
          </span>
        )}
        <span class="subject">{issue.subject}</span>
        {preview && <span class="snippet">{preview}</span>}
      </a>
      <span class="meta">
        <time dateTime={issue.receivedAt}>{relativeTime(issue.receivedAt)}</time>
        <span aria-hidden="true">·</span>
        <span>{issue.readMinutes} min</span>
        {issue.topic &&
          (topicHref ? (
            <a class="topic" href={topicHref(issue.topic)} title={`Only ${issue.topic}`}>
              {issue.topic}
            </a>
          ) : (
            <span class="topic">{issue.topic}</span>
          ))}
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
    </li>
  );
}
