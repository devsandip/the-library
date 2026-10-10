import { useLocation } from "preact-iso";
import { isReaderDay, readerDay } from "@library/core/days";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { dayLine, shortDay } from "../format.js";
import { useAsync } from "../hooks.js";
import { PANES, useMedia, WIDE } from "../media.js";
import { backIfPossible } from "../nav.js";
import { BackIcon } from "../components/icons.js";
import { IssueCard } from "../components/issue-card.js";
import { IssueReader } from "../components/issue-reader.js";
import { IssueRow } from "../components/issue-row.js";
import { useSaveToggle } from "../components/save.js";
import { patchIssue } from "../groups.js";

const historyHref = (day: string, issue?: string) =>
  `${BASE}/history?day=${day}${issue ? `&issue=${encodeURIComponent(issue)}` : ""}`;

/**
 * Read history (#42): the issues opened on one day, latest first. Earlier and later skip days
 * with nothing read; the date field goes to any day. The day lives in the URL, so Back steps
 * through the days visited.
 */
export function History() {
  const { api } = useApp();
  const { query, route } = useLocation();
  const wide = useMedia(WIDE);
  const panes = useMedia(PANES);
  const today = readerDay(Date.now());
  const day = query.day && isReaderDay(query.day) && query.day <= today ? query.day : today;
  const history = useAsync(() => api.history(day), [day]);
  const open = panes ? query.issue : undefined;

  const save = useSaveToggle((id, change) =>
    history.set((d) => ({ ...d, items: patchIssue(d.items, id, change) })),
  );

  const go = (d: string) => route(historyHref(d));
  const openHere = (id: string) => route(historyHref(day, id), true);
  const items = history.data?.items ?? [];
  const before = history.data?.previousDay;
  const after = history.data?.nextDay;

  const days = (
    <nav class="history-days" aria-label="Days">
      <button type="button" class="pill" disabled={!before} onClick={() => before && go(before)}>
        <BackIcon />
        {before ? shortDay(before) : "Earlier"}
      </button>
      <input
        type="date"
        id="history-day"
        class="day-pick"
        aria-label="Go to a day"
        value={day}
        max={today}
        onChange={(e) => {
          const picked = (e.target as HTMLInputElement).value;
          if (isReaderDay(picked) && picked !== day) go(picked);
        }}
      />
      <button
        type="button"
        class="pill forward"
        disabled={!after}
        onClick={() => after && go(after)}
      >
        {after ? shortDay(after) : "Later"}
        <BackIcon />
      </button>
      {day !== today && (
        <button type="button" class="link" onClick={() => go(today)}>
          Today
        </button>
      )}
    </nav>
  );

  const subline = (
    <p class="subline">
      {dayLine(day)}
      {history.status === "ok" &&
        items.length > 0 &&
        ` · ${items.length} ${items.length === 1 ? "issue" : "issues"} read`}
    </p>
  );

  const body = (
    <>
      {history.status === "loading" && <p class="subline list-note">Looking up that day...</p>}
      {history.status === "error" && (
        <p class="error list-note">
          {history.error}{" "}
          <button type="button" class="link" onClick={history.reload}>
            Retry
          </button>
        </p>
      )}
      {history.status === "ok" && items.length === 0 && (
        <div class="empty">
          <p class="empty-title">Nothing read on this day.</p>
          {before && (
            <p class="muted">
              <button type="button" class="link" onClick={() => go(before)}>
                Go to {dayLine(before)}
              </button>
            </p>
          )}
        </div>
      )}
      {items.length > 0 &&
        (wide ? (
          <ul class="rows">
            {items.map((i) => (
              <IssueRow
                key={i.id}
                issue={i}
                openedAt={i.openedAt}
                selected={i.id === open}
                onOpen={panes ? openHere : undefined}
                onSave={save}
              />
            ))}
          </ul>
        ) : (
          <ul class="cards">
            {items.map((i) => (
              <IssueCard key={i.id} issue={i} openedAt={i.openedAt} onSave={save} />
            ))}
          </ul>
        ))}
    </>
  );

  if (!wide) {
    return (
      <section class="history">
        <a class="back" href={`${BASE}/`} onClick={backIfPossible}>
          <BackIcon /> Library
        </a>
        <h1>History</h1>
        {subline}
        {days}
        {body}
      </section>
    );
  }

  return (
    <div class={`desk-home${panes ? " with-reader" : ""}`}>
      <section class="pane-list history" aria-label="History">
        <header class="list-head">
          <h1>History</h1>
          {subline}
          {days}
        </header>
        {body}
      </section>
      {panes && (
        <section class="pane-reader" aria-label="Reading pane">
          {open ? (
            <IssueReader key={open} id={open} wide onOpen={openHere} />
          ) : (
            <div class="reader-empty">
              <p class="empty-title">Pick an issue to read it again here.</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
