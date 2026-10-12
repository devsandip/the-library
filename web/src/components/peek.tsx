import { useEffect, useRef, useState } from "preact/hooks";
import type { IssueListItem } from "@library/core/types";
import { useApp } from "../context.js";
import { useStories } from "../data.js";
import { useLibrary } from "../library.js";

/** A second tap within this long opens the issue instead of peeking (#41). */
export const DOUBLE_TAP_MS = 260;

/** A peek left open this long reads the issue (#56); one folded away sooner was only a glance. */
export const PEEK_READ_MS = 2000;

/** How many of a digest's stories the peek lists. */
const PEEK_STORIES = 3;

/** Only web links: a story's link comes from the newsletter. */
export const isWebLink = (url: string | undefined): url is string =>
  !!url && /^https?:\/\//i.test(url);

/**
 * Tap and double tap on a row (#41). The row shows as pressed the moment a finger lands, which
 * hides the wait; one tap toggles the peek once 260 ms pass with no second tap; a second tap
 * inside that opens the issue with no peek flashing first. A tap where `opensAt` says (the
 * row's title) opens at once. Enter opens at once (a click with no pointer behind it), Space
 * peeks, and modified clicks keep the browser's own behaviour.
 */
export function useTapToPeek(actions: {
  toggle: () => void;
  open: () => void;
  /** Whether a tap on this target opens the issue straight away instead of peeking. */
  opensAt?: (target: EventTarget | null) => boolean;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(actions);
  latest.current = actions;
  const [pressed, setPressed] = useState(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    pressed,
    /** A press that turned into a scroll or a swipe is not a tap. */
    release: () => {
      if (timer.current === undefined) setPressed(false);
    },
    props: {
      onPointerDown: (e: PointerEvent) => {
        if (e.button === 0) setPressed(true);
      },
      onPointerCancel: () => {
        if (timer.current === undefined) setPressed(false);
      },
      onClick: (e: MouseEvent) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        // preact-iso follows in-scope links from a window listener that ignores preventDefault.
        e.preventDefault();
        e.stopPropagation();
        if (e.detail === 0 || timer.current !== undefined || latest.current.opensAt?.(e.target)) {
          clearTimeout(timer.current);
          timer.current = undefined;
          setPressed(false);
          latest.current.open();
          return;
        }
        setPressed(true);
        timer.current = setTimeout(() => {
          timer.current = undefined;
          setPressed(false);
          latest.current.toggle();
        }, DOUBLE_TAP_MS);
      },
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key !== " ") return;
        e.preventDefault();
        latest.current.toggle();
      },
      // A double click must not select a word on its way to opening the issue.
      onMouseDown: (e: MouseEvent) => {
        if (e.detail > 1) e.preventDefault();
      },
    },
  };
}

/**
 * Peek counts as reading (#56): a peek held open 2 s logs a read in History and marks an unread
 * issue read, as opening it would.
 */
export function usePeekRead(
  issue: IssueListItem,
  open: boolean,
  onChange?: (id: string, change: Partial<IssueListItem>) => void,
) {
  const { api } = useApp();
  const { counts } = useLibrary();
  const latest = useRef({ issue, onChange });
  latest.current = { issue, onChange };
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const { issue: i, onChange: changed } = latest.current;
      void api.logPeek(i.id).catch(() => undefined);
      if (i.state !== "unread") return;
      changed?.(i.id, { state: "read" });
      void api.setState(i.id, "read").then(counts.reload, () => undefined);
    }, PEEK_READ_MS);
    return () => clearTimeout(timer);
  }, [issue.id, open]);
}

/**
 * What is inside an issue, under its row (#41): a digest's first stories, each with its headline,
 * one line and a way to its own link; for a single story, what it says. All from the story index,
 * so no new Claude call.
 */
export function Peek({
  issue,
  id,
  onOpen,
  wide = false,
}: {
  issue: IssueListItem;
  /** The element id the row points at with aria-controls. */
  id: string;
  onOpen: () => void;
  /** The Mac's queue: Space peeks, Enter opens. */
  wide?: boolean;
}) {
  const read = useStories(issue.id);
  const stories = read.data?.stories ?? [];
  const shown = stories.slice(0, PEEK_STORIES);
  const more = stories.length - shown.length;
  const digest = stories.length > 1;

  return (
    <div class="peek" id={id} role="region" aria-label={`Inside ${issue.subject}`}>
      {digest && (
        <div class="peek-head label">
          <span>Inside · {stories.length} stories</span>
          <span>{wide ? "Enter opens" : "Double tap opens"}</span>
        </div>
      )}
      {read.status === "loading" && <p class="peek-note">Looking inside…</p>}
      {read.status === "error" && <p class="peek-note">{read.error}</p>}
      {digest &&
        shown.map((s) => (
          <div class="peek-story" key={s.n}>
            <span class="peek-n">{s.n}</span>
            <div class="peek-body">
              <span class="peek-headline">{s.headline}</span>
              <span class="peek-line">{s.summary}</span>
            </div>
            {isWebLink(s.link) ? (
              <a
                class="peek-go"
                href={s.link}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Source of ${s.headline}`}
              >
                ↗
              </a>
            ) : (
              <span class="peek-go" aria-hidden="true" />
            )}
          </div>
        ))}
      {read.status === "ok" && stories.length === 1 && (
        <p class="peek-summary">{stories[0]!.summary}</p>
      )}
      {read.status === "ok" && stories.length === 0 && (
        <p class="peek-summary">
          <span class="label">Not split into stories yet · </span>
          {issue.summary ?? issue.snippet}
        </p>
      )}
      <div class="peek-foot">
        <span class="label">{more > 0 ? `${more} more` : ""}</span>
        <button type="button" class="btn fill sm" onClick={onOpen}>
          Open issue
        </button>
      </div>
    </div>
  );
}
