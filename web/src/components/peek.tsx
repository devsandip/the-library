import { useEffect, useRef } from "preact/hooks";
import type { IssueListItem, IssueStoriesResponse } from "@library/core/types";
import { useApp } from "../context.js";
import { useAsync } from "../hooks.js";
import { ExternalIcon } from "./icons.js";

/** A second tap within this long opens the issue instead of peeking (#41). */
export const DOUBLE_TAP_MS = 250;

/** Stories are read once per issue a page load: they change only when an issue is split again. */
const cache = new Map<string, Promise<IssueStoriesResponse>>();

/** Only web links: a story's link comes from the newsletter. */
const isWebLink = (url: string) => /^https?:\/\//i.test(url);

/**
 * Tap and double tap on a row's link (#41). One tap toggles the peek once the double-tap window
 * has passed; a second tap inside it opens the issue, without the peek flashing first. Enter opens
 * at once (a click with no pointer behind it), Space peeks, and modified clicks keep the browser's
 * own behaviour (new tab, new window).
 */
export function useTapToPeek(actions: { toggle: () => void; open: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    onClick: (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      // preact-iso follows in-scope links from a window listener that ignores preventDefault.
      e.preventDefault();
      e.stopPropagation();
      if (e.detail === 0 || timer.current !== undefined) {
        clearTimeout(timer.current);
        timer.current = undefined;
        latest.current.open();
        return;
      }
      timer.current = setTimeout(() => {
        timer.current = undefined;
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
  };
}

/**
 * What is inside an issue, under its row (#41): a digest's stories, each with its headline, a line
 * and its source; for a single story, what it says. All from the story index, so no new Claude
 * call.
 */
export function StoryPeek({
  issue,
  id,
  onOpen,
}: {
  issue: IssueListItem;
  /** The element id the row's link points at with aria-controls. */
  id: string;
  onOpen: () => void;
}) {
  const { api } = useApp();
  const read = useAsync(() => {
    let stories = cache.get(issue.id);
    if (!stories) {
      stories = api.stories(issue.id);
      cache.set(issue.id, stories);
      stories.catch(() => cache.delete(issue.id));
    }
    return stories;
  }, [issue.id]);
  const stories = read.data?.stories ?? [];

  return (
    <div class="peek" id={id} role="region" aria-label={`Inside ${issue.subject}`}>
      {read.status === "loading" && <p class="peek-note">Looking inside...</p>}
      {read.status === "error" && <p class="peek-note">{read.error}</p>}
      {read.status === "ok" && stories.length > 1 && (
        <>
          <p class="peek-label">{stories.length} stories</p>
          <ol class="peek-stories">
            {stories.map((s) => (
              <li key={s.n}>
                <span class="peek-headline">{s.headline}</span>
                <span class="peek-text">{s.summary}</span>
                {s.link && isWebLink(s.link) && (
                  <a class="peek-source" href={s.link} target="_blank" rel="noopener noreferrer">
                    Source <ExternalIcon />
                  </a>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      {read.status === "ok" && stories.length === 1 && (
        <p class="peek-text">{stories[0]!.summary}</p>
      )}
      {read.status === "ok" && stories.length === 0 && (
        <p class="peek-note">Not split into stories yet. {issue.snippet}</p>
      )}
      <button type="button" class="pill peek-open" onClick={onOpen}>
        Read it
      </button>
    </div>
  );
}
