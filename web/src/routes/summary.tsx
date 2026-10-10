import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { IssueListItem } from "@library/core/types";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { issueHref } from "../filters.js";
import { todayLine } from "../format.js";
import { useAsync } from "../hooks.js";
import { PANES, useMedia, WIDE } from "../media.js";
import { backIfPossible, clickInPlace } from "../nav.js";
import { IssueReader } from "../components/issue-reader.js";
import { ArchiveIcon, BackIcon, StarIcon } from "../components/icons.js";

/** Skimming one-line summaries runs at about 200 words a minute. */
function skimMinutes(lines: string[]): number {
  const words = lines.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/**
 * The 20 most relevant unread News issues, best first (#11). One card of lines on the phone; a
 * list column on the Mac, with the reading pane beside it when the window is wide enough.
 */
export function Summary() {
  const { api } = useApp();
  const { query, route } = useLocation();
  const wide = useMedia(WIDE);
  const panes = useMedia(PANES);
  const summary = useAsync(() => api.summary(), []);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const open = panes ? query.issue : undefined;
  const items = (summary.data?.items ?? []).filter((i) => !gone.has(i.id));
  const hide = (ids: string[], on: boolean) =>
    setGone((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const archive = async (id: string) => {
    setError(undefined);
    hide([id], true);
    try {
      await api.setState(id, "archived");
    } catch (err) {
      hide([id], false);
      setError((err as Error).message);
    }
  };

  /** Clears the list on screen and brings up the next most relevant issues. */
  const markAllRead = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const ids = items.map((i) => i.id);
      for (let n = 0; n < ids.length; n += 5) {
        await Promise.all(ids.slice(n, n + 5).map((id) => api.setState(id, "read")));
      }
      setGone(new Set());
      summary.reload();
    } catch (err) {
      setError((err as Error).message);
      summary.reload();
    } finally {
      setBusy(false);
    }
  };

  const candidates = summary.data?.candidates ?? 0;
  const minutes = skimMinutes(items.map((i) => i.summary ?? i.subject));

  const row = (i: IssueListItem) => (
    <li class={`summary-row${i.id === open ? " selected" : ""}`} key={i.id}>
      <a
        href={issueHref(i.id)}
        aria-current={i.id === open ? "true" : undefined}
        onClick={(e) => {
          if (panes) {
            clickInPlace(e, () => route(`${BASE}/summary?issue=${encodeURIComponent(i.id)}`, true));
          }
        }}
      >
        <span class="row-pub">
          {!wide && <span class="dot" aria-hidden="true" />}
          <span class="row-name">{i.publication}</span>
          {i.mustRead && (
            <span class="star" title="Must Read">
              <StarIcon filled />
              <span class="sr-only">Must Read</span>
            </span>
          )}
        </span>
        <span class="summary-line">{i.summary ?? i.subject}</span>
        {i.scoreReason && <span class="reason">{i.scoreReason}</span>}
      </a>
      <button
        type="button"
        class="icon-button"
        title="Archive"
        aria-label={`Archive ${i.subject}`}
        onClick={() => void archive(i.id)}
      >
        <ArchiveIcon />
      </button>
    </li>
  );

  const body = (
    <>
      {summary.status === "loading" && <p class="subline">Ranking today's news...</p>}
      {summary.status === "error" && (
        <p class="error list-note">
          {summary.error}{" "}
          <button type="button" class="link" onClick={summary.reload}>
            Retry
          </button>
        </p>
      )}
      {error && <p class="error list-note">{error}</p>}
      {summary.status === "ok" && items.length === 0 && (
        <div class="empty">
          <p class="empty-title">No new numbers.</p>
          <p class="muted">No unread news right now. New issues arrive every two hours.</p>
        </div>
      )}
      {items.length > 0 && (
        <>
          <ol class="summary-list">{items.map(row)}</ol>
          <p class="mark-all">
            <button type="button" class="pill" onClick={markAllRead} disabled={busy}>
              {busy
                ? "Marking..."
                : items.length === 1
                  ? "Mark it read"
                  : `Mark all ${items.length} read`}
            </button>
          </p>
        </>
      )}
    </>
  );
  const subline = summary.status === "ok" && (
    <p class="subline">
      {todayLine()}
      {items.length > 0 &&
        ` · ${items.length < candidates ? `top ${items.length} of ${candidates}` : candidates} unread in News · about ${minutes} ${minutes === 1 ? "minute" : "minutes"} to skim`}
    </p>
  );

  if (!wide) {
    return (
      <section class="summary">
        <a class="back" href={`${BASE}/`} onClick={backIfPossible}>
          <BackIcon /> Library
        </a>
        <h1>Summary</h1>
        {subline}
        {body}
      </section>
    );
  }

  return (
    <div class={`desk-home${panes ? " with-reader" : ""}`}>
      <section class="pane-list summary" aria-label="Summary">
        <header class="list-head">
          <h1>Summary</h1>
          {subline}
        </header>
        {body}
      </section>
      {panes && (
        <section class="pane-reader" aria-label="Reading pane">
          {open ? (
            <IssueReader
              key={open}
              id={open}
              wide
              onChange={(id, change) => {
                if (change.state) hide([id], change.state === "archived");
              }}
            />
          ) : (
            <div class="reader-empty">
              <p class="empty-title">Pick a line to read the issue here.</p>
              <p class="muted">Opening one marks it read.</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
