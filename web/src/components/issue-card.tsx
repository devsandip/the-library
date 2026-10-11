import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { IssueListItem } from "@library/core/types";
import { issueHref } from "../filters.js";
import { clockTime, relativeTime } from "../format.js";
import { Highlight } from "./highlight.js";
import { StarIcon, ThumbDown, ThumbUp } from "./icons.js";
import type { Found } from "./issue-row.js";
import { StoryPeek, useTapToPeek } from "./peek.js";
import { SaveButton } from "./save.js";
import { SwipeUnder, useSwipe, type SwipeActions } from "./swipe.js";

/**
 * A briefing card on the phone (#12): Claude's one line first, then where it came from. A lead
 * card (the Must Read row) also names the newsletter up top and keeps the headline. A tap peeks
 * inside the issue and a double tap opens it (#41); lead cards open on a tap, since a card that
 * grew would stretch the whole sideways row.
 */
export function IssueCard({
  issue,
  lead = false,
  showPublication = true,
  openedAt,
  swipe,
  onSave,
  onChange,
  found,
}: {
  issue: IssueListItem;
  lead?: boolean;
  showPublication?: boolean;
  /** In read history (#42): when it was read (opened, or peeked at, #56), not when it arrived. */
  openedAt?: string;
  /** Swipe to rate (#13); absent where cards do not swipe (the sideways Must Read row). */
  swipe?: SwipeActions;
  /** Save for later (#43): the card gets a bookmark. */
  onSave?: (issue: IssueListItem) => void;
  /** Tells the list what a peek changed (#56), so the card keeps up. */
  onChange?: (id: string, change: Partial<IssueListItem>) => void;
  /** A search result (#53): the words to mark, and the story inside a digest that matched. */
  found?: Found;
}) {
  const unread = issue.state === "unread";
  const s = useSwipe(swipe);
  const { route } = useLocation();
  const [peeking, setPeeking] = useState(false);
  const tap = useTapToPeek({
    toggle: () => setPeeking((on) => !on),
    open: () => route(issueHref(issue.id)),
  });
  const peekId = `peek-${issue.id}`;
  const saves = onSave !== undefined && issue.state !== "archived";
  const bookmark = onSave && <SaveButton issue={issue} onSave={onSave} />;
  const link = (
    <a
      href={issueHref(issue.id)}
      {...(lead
        ? {}
        : { ...tap, "aria-expanded": peeking, "aria-controls": peeking ? peekId : undefined })}
    >
      {lead && <span class="card-pub">{issue.publication}</span>}
      <span class="card-line">
        <Highlight text={issue.summary ?? issue.subject} terms={found?.terms} />
      </span>
      {/* A search result shows the subject too: the words may be there and not in Claude's line. */}
      {(lead || found) && issue.summary && (
        <span class="card-title">
          <Highlight text={issue.subject} terms={found?.terms} />
        </span>
      )}
      {found?.story && (
        <span class="found-story">
          <Highlight text={found.story} terms={found.terms} />
        </span>
      )}
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
        {openedAt ? (
          <time dateTime={openedAt}>Read {clockTime(openedAt)}</time>
        ) : (
          <time dateTime={issue.receivedAt}>{relativeTime(issue.receivedAt)}</time>
        )}
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
  );
  const body = (
    <>
      <div class="card-main">
        {link}
        {bookmark}
      </div>
      {peeking && (
        <StoryPeek
          issue={issue}
          id={peekId}
          onOpen={() => route(issueHref(issue.id))}
          onChange={onChange}
        />
      )}
    </>
  );
  return (
    <li
      class={`issue-card${lead ? " lead" : ""}${unread ? " unread" : ""}${swipe ? " swipe" : ""}${saves ? " can-save" : ""}${peeking ? " peeking" : ""}`}
      {...s.rowProps}
    >
      {swipe ? (
        <>
          <SwipeUnder />
          <div class="swipe-face" ref={s.face}>
            {body}
          </div>
        </>
      ) : (
        body
      )}
    </li>
  );
}
