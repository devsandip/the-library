import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { IssueListItem } from "@library/core/types";
import { issueHref } from "../filters.js";
import { clockTime, relativeTime } from "../format.js";
import { clickInPlace } from "../nav.js";
import { Highlight } from "./highlight.js";
import { StarIcon, ThumbDown, ThumbUp } from "./icons.js";
import { StoryPeek, useTapToPeek } from "./peek.js";
import { SaveButton } from "./save.js";

/** What a search found in a row or card (#53). */
export interface Found {
  terms: string[];
  /** The headline of the story inside a digest that matched. */
  story?: string;
}

/**
 * A row in the Mac's list column (#12): newsletter and time, the headline, Claude's line. With the
 * reading pane, a click opens the issue there; without it, a click peeks inside the issue and a
 * double click opens it (#41).
 */
export function IssueRow({
  issue,
  showPublication = true,
  selected = false,
  openedAt,
  onOpen,
  onSave,
  onChange,
  found,
}: {
  issue: IssueListItem;
  showPublication?: boolean;
  /** Showing in the reading pane. */
  selected?: boolean;
  /** In read history (#42): when it was read (opened, or peeked at, #56), not when it arrived. */
  openedAt?: string;
  /** Open in the reading pane instead of on its own page. */
  onOpen?: (id: string) => void;
  /** Save for later (#43): the row gets a bookmark. */
  onSave?: (issue: IssueListItem) => void;
  /** Tells the list what a peek changed (#56), so the row keeps up. */
  onChange?: (id: string, change: Partial<IssueListItem>) => void;
  /** A search result (#53): the words to mark, and the story inside a digest that matched. */
  found?: Found;
}) {
  const unread = issue.state === "unread";
  const preview = issue.summary ?? issue.snippet;
  const saves = onSave !== undefined && issue.state !== "archived";
  const { route } = useLocation();
  const [peeking, setPeeking] = useState(false);
  const open = () => route(issueHref(issue.id));
  const tap = useTapToPeek({ toggle: () => setPeeking((on) => !on), open });
  const peekId = `peek-${issue.id}`;
  return (
    <li
      class={`issue-row${unread ? " unread" : ""}${selected ? " selected" : ""}${saves ? " can-save" : ""}${peeking ? " peeking" : ""}`}
    >
      <a
        class="row-link"
        href={issueHref(issue.id)}
        aria-current={selected ? "true" : undefined}
        {...(onOpen
          ? { onClick: (e: MouseEvent) => clickInPlace(e, () => onOpen(issue.id)) }
          : { ...tap, "aria-expanded": peeking, "aria-controls": peeking ? peekId : undefined })}
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
            {openedAt ? (
              <time dateTime={openedAt} title="Read">
                {clockTime(openedAt)}
              </time>
            ) : (
              <time dateTime={issue.receivedAt}>{relativeTime(issue.receivedAt)}</time>
            )}
          </span>
        </span>
        <span class="subject">
          <Highlight text={issue.subject} terms={found?.terms} />
        </span>
        {found?.story && (
          <span class="found-story">
            <Highlight text={found.story} terms={found.terms} />
          </span>
        )}
        {preview && (
          <span class="snippet">
            <Highlight text={preview} terms={found?.terms} />
          </span>
        )}
      </a>
      {onSave && <SaveButton issue={issue} onSave={onSave} />}
      {peeking && !onOpen && (
        <StoryPeek issue={issue} id={peekId} onOpen={open} onChange={onChange} />
      )}
    </li>
  );
}
