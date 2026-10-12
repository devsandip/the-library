import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { IssueListItem } from "@library/core/types";
import type { IssueActions } from "../actions.js";
import { swipeChange } from "../gesture.js";
import { age, clockTime } from "../format.js";
import { clickInPlace } from "../nav.js";
import { Highlight } from "./highlight.js";
import { Peek, usePeekRead, useTapToPeek } from "./peek.js";
import { SwipeUnder, useSwipe } from "./swipe.js";

/** What a search found in a row (#53): the words to mark, and the digest's story that matched. */
export interface Found {
  terms: string[];
  story?: string;
}

/** The row's state as tags: topic · ✓ Relevant · Saved · Read. */
function Tags({ issue, topic, saved }: { issue: IssueListItem; topic: boolean; saved: boolean }) {
  const tags: preact.JSX.Element[] = [];
  if (issue.rating === 1) tags.push(<span class="rel">✓ Relevant</span>);
  if (issue.rating === -1) tags.push(<span class="irr">✕ Irrelevant</span>);
  if (saved && issue.savedAt !== undefined) tags.push(<span>Saved</span>);
  if (issue.state === "read") tags.push(<span>Read</span>);
  if (issue.state === "archived") tags.push(<span>Archived</span>);
  if (!tags.length) return null;
  if (topic && issue.topic) tags.unshift(<span>{issue.topic}</span>);
  return (
    <span class="row-tags label">
      {tags.map((t, k) => (
        <>
          {k > 0 && " · "}
          {t}
        </>
      ))}
    </span>
  );
}

/**
 * One issue in a list: Browse, Saved, Today's list view and Library's pages. The newsletter (with
 * ★ for Must Read) and its age, the subject, Claude's line, and its state as tags. On the phone a
 * tap on the title opens the issue; a tap anywhere else peeks inside and a double tap opens (#41),
 * and a swipe rates (#13); every swipe also has a button for VoiceOver. On the Mac a click opens
 * the issue in the console.
 */
export function Row({
  issue,
  href,
  actions,
  leaves = false,
  onChange,
  dim = false,
  rank,
  five = false,
  found,
  read,
  wide = false,
  showPublication = true,
  savedTag = true,
}: {
  issue: IssueListItem;
  /** Where opening it goes. */
  href: string;
  /** Rating, saving and archiving: swipes on the phone, plus hidden buttons for VoiceOver. */
  actions?: IssueActions;
  /** A left swipe collapses the row away (lists that leave archived issues out). */
  leaves?: boolean;
  /** Tells the list what a peek changed (#56). */
  onChange?: (id: string, change: Partial<IssueListItem>) => void;
  /** Read or saved this session: it stays in place, faded, until the view changes (RET-10). */
  dim?: boolean;
  /** Today's list view: the rank, and whether it is one of the day's five. */
  rank?: number;
  five?: boolean;
  found?: Found;
  /** In History: when it was read, and how (opened, or a peek left open). */
  read?: { at: string; via: "open" | "peek" };
  wide?: boolean;
  showPublication?: boolean;
  /** Off on the Saved list, where every row is saved. */
  savedTag?: boolean;
}) {
  const { route } = useLocation();
  const [peeking, setPeeking] = useState(false);
  const open = () => route(href);
  const tap = useTapToPeek({
    toggle: () => setPeeking((on) => !on),
    open,
    opensAt: (target) => target instanceof Element && target.closest(".row-title") !== null,
  });
  usePeekRead(issue, peeking && !wide, onChange);
  const swipes = !wide && actions;
  const s = useSwipe(
    swipes
      ? {
          right: swipeChange(issue, "right")
            ? () => actions.relevant(issue, { quiet: true })
            : undefined,
          left: swipeChange(issue, "left") ? () => actions.irrelevant(issue) : undefined,
          leaves: leaves && issue.state !== "archived",
        }
      : undefined,
    tap.release,
  );
  const peekId = `peek-${issue.id}`;

  const meta = (
    <span class="row-meta label">
      <span class={`row-pub${issue.mustRead ? " must" : ""}`}>
        {rank !== undefined && (
          <span class={`row-rank${five ? " five" : ""}`}>{String(rank).padStart(2, "0")}</span>
        )}
        {issue.mustRead && <span aria-label="Must Read">★ </span>}
        {showPublication ? issue.publication : (issue.topic ?? "")}
      </span>
      <span class="row-when">
        {read ? (
          <>
            {read.via === "peek" ? "Read" : "Opened"} {clockTime(read.at)}
          </>
        ) : (
          <>
            {age(issue.receivedAt)} · {issue.readMinutes} min
          </>
        )}
      </span>
    </span>
  );

  const link = (
    <a
      class="row"
      href={href}
      {...(wide
        ? { onClick: (e: MouseEvent) => clickInPlace(e, open) }
        : {
            ...tap.props,
            "aria-expanded": peeking,
            "aria-controls": peeking ? peekId : undefined,
          })}
    >
      {meta}
      <span class="row-title">
        <Highlight text={issue.subject} terms={found?.terms} />
      </span>
      {found?.story && (
        <span class="row-found">
          In this issue: <Highlight text={found.story} terms={found.terms} />
        </span>
      )}
      {!peeking && (issue.summary || found) && (
        <span class="row-line">
          <Highlight text={issue.summary ?? issue.snippet} terms={found?.terms} />
        </span>
      )}
      {!peeking && <Tags issue={issue} topic={showPublication} saved={savedTag} />}
    </a>
  );

  return (
    <li
      class={`row-item${swipes ? " swipe" : ""}${peeking ? " peeking" : ""}${tap.pressed ? " pressed" : ""}${dim && !peeking ? " dim" : ""}`}
      {...s.rowProps}
    >
      {swipes && <SwipeUnder />}
      <div class="row-face" ref={s.face}>
        {link}
        {swipes && (
          // VoiceOver's equivalent of the swipes and the peek.
          <span class="sr-only">
            <button type="button" onClick={() => actions.relevant(issue)}>
              Relevant
            </button>
            <button type="button" onClick={() => actions.irrelevant(issue)}>
              Irrelevant and archive
            </button>
            {issue.state !== "archived" && (
              <button type="button" onClick={() => actions.save(issue)}>
                {issue.savedAt ? "Take off Saved" : "Save for later"}
              </button>
            )}
          </span>
        )}
        {peeking && !wide && <Peek issue={issue} id={peekId} onOpen={open} />}
      </div>
    </li>
  );
}
