import { useState } from "preact/hooks";
import { readerDay } from "@library/core/days";
import type { IssueListItem } from "@library/core/types";
import { BASE } from "../config.js";
import { shortDate } from "../format.js";
import { exportFile, groups, newsletters, pick, useHighlights } from "../highlights.js";
import { highlightHref, queueHref, withHighlight } from "../paths.js";
import { useToast } from "../components/toast.js";
import { Failed } from "../components/ui.js";
import { Page, openHref } from "./page.js";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * Highlights (#168): every passage kept while reading, grouped by issue, the issue highlighted
 * last first, each with its note; a newsletter filter and a since-day. Each passage opens the
 * issue at it. What is shown copies or downloads as one Markdown file, for any notes app.
 */
export function Highlights({ wide }: { wide: boolean }) {
  const toast = useToast();
  const { state, reload } = useHighlights();
  const [newsletter, setNewsletter] = useState("");
  const [since, setSince] = useState("");
  const items = state.status === "ok" ? state.items : [];
  const shown = pick(items, { newsletter: newsletter || undefined, since: since || undefined });
  const issueHref = openHref(wide);
  const at = (i: IssueListItem, id: string) =>
    wide
      ? withHighlight(queueHref(i.shelf === "learning" ? "learning" : "news", undefined, i.id), id)
      : highlightHref(i.id, id);
  const sub = items.length
    ? `${plural(items.length, "highlight")} from ${plural(groups(items).length, "issue")}`
    : undefined;

  const file = () =>
    exportFile(shown, {
      appUrl: `${location.origin}${BASE}`,
      since: since || undefined,
      now: Date.now(),
    });
  const copy = () =>
    navigator.clipboard.writeText(file().markdown).then(
      () => toast.say(`Copied ${plural(shown.length, "highlight")} as Markdown`),
      () => toast.say("Could not copy. Download the file instead"),
    );
  const download = () => {
    const f = file();
    const url = URL.createObjectURL(new Blob([f.markdown], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Page title="Highlights" wide={wide} sub={sub} class="highlights">
      {state.status === "loading" && (
        <ol class="deep-skeleton" aria-hidden="true">
          <li />
          <li />
        </ol>
      )}
      {state.status === "error" && <Failed message={state.error} retry={reload} />}
      {state.status === "ok" && !items.length && (
        <p class="search-hint">
          Select a passage while reading and {wide ? "press H, or click" : "tap"} Highlight. Your
          highlights collect here with your notes, ready to copy or download as Markdown for
          Obsidian or any notes app.
        </p>
      )}
      {items.length > 0 && (
        <>
          <div class="hl-tools">
            <label class="hl-tool">
              <span class="label">Newsletter</span>
              <select
                class="btn line sm"
                value={newsletter}
                onChange={(e) => setNewsletter((e.target as HTMLSelectElement).value)}
              >
                <option value="">All</option>
                {newsletters(items).map((n) => (
                  <option key={n.publication} value={n.publication}>
                    {n.publication} · {n.count}
                  </option>
                ))}
              </select>
            </label>
            <label class="hl-tool">
              <span class="label">Since</span>
              <input
                type="date"
                class="btn line sm"
                value={since}
                max={readerDay(Date.now())}
                onInput={(e) => setSince((e.target as HTMLInputElement).value)}
              />
            </label>
          </div>
          <div class="hl-export" role="group" aria-label="Export">
            <button type="button" class="btn line sm" disabled={!shown.length} onClick={copy}>
              Copy Markdown
            </button>
            <button type="button" class="btn line sm" disabled={!shown.length} onClick={download}>
              Download .md
            </button>
            <span class="label">{plural(shown.length, "highlight")}</span>
          </div>
          {!shown.length && (
            <p class="search-hint">
              None{newsletter ? ` from ${newsletter}` : ""}
              {since ? " since that day" : ""}.
            </p>
          )}
          {groups(shown).map((g) => (
            <article key={g.issue.id} class="hl-group">
              <p class="label follow-meta">
                {g.issue.publication} · {shortDate(g.issue.receivedAt)}
              </p>
              <h2 class="follow-h">
                <a href={issueHref(g.issue)}>{g.issue.subject}</a>
              </h2>
              <ul class="hl-list">
                {g.highlights.map((h) => (
                  <li key={h.id}>
                    <a class="hl-item" href={at(g.issue, h.id)}>
                      <span class="hl-passage">{h.exact}</span>
                      {h.note && <span class="hl-passage-note">{h.note}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </>
      )}
    </Page>
  );
}
