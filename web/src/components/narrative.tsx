import { useState } from "preact/hooks";
import type { Narrative } from "@library/core/types";
import { issueHref } from "../filters.js";
import { narrativeLine } from "../format.js";
import { clickInPlace } from "../nav.js";
import { ChevronIcon } from "./icons.js";

/** Whether the narrative is folded shut, remembered in this browser. */
const FOLDED_KEY = "library.narrative.folded";

function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLDED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Today's news as a few threads (#18): a paragraph each, naming the newsletters it came from,
 * linked to their issues. Above the Summary's list it folds shut; in the Mac's empty reading pane
 * it stays open.
 */
export function DayInBrief({
  narrative,
  foldable,
  onOpen,
}: {
  narrative: Narrative;
  foldable: boolean;
  /** Open an issue in the reading pane instead of on its own page. */
  onOpen?: (id: string) => void;
}) {
  const [folded, setFolded] = useState(() => foldable && readFolded());
  const fold = () => {
    setFolded(!folded);
    try {
      localStorage.setItem(FOLDED_KEY, folded ? "0" : "1");
    } catch {
      // Blocked storage: the fold lasts until the page reloads.
    }
  };

  return (
    <section class={`narrative${foldable ? " foldable" : ""}`} aria-label="The day in brief">
      <h2 class="narrative-head">
        {foldable ? (
          <button
            type="button"
            class="narrative-fold"
            aria-expanded={!folded}
            aria-controls="narrative-threads"
            onClick={fold}
          >
            <ChevronIcon />
            The day in brief
          </button>
        ) : (
          "The day in brief"
        )}
      </h2>
      <p class="narrative-meta">{narrativeLine(narrative)}</p>
      <div id="narrative-threads" class="narrative-threads" hidden={folded}>
        {narrative.threads.map((t) => (
          <article class="thread" key={t.title}>
            <h3>{t.title}</h3>
            <p class="thread-text">{t.text}</p>
            <p class="thread-sources">
              {t.sources.map((s, k) => (
                <span key={s.issueId}>
                  {k > 0 && ", "}
                  <a
                    href={issueHref(s.issueId)}
                    onClick={(e) => {
                      if (onOpen) clickInPlace(e, () => onOpen(s.issueId));
                    }}
                  >
                    {s.publication}
                  </a>
                </span>
              ))}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
