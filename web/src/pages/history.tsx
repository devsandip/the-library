import { useLocation } from "preact-iso";
import { isReaderDay, readerDay } from "@library/core/days";
import type { HistoryItem } from "@library/core/types";
import { useApp } from "../context.js";
import { patchIssue } from "../data.js";
import { dayLine, shortDay } from "../format.js";
import { useAsync } from "../hooks.js";
import { useScrollMemory } from "../nav.js";
import { historyHref } from "../paths.js";
import { Row } from "../components/row.js";
import { Empty, Failed, Skeleton } from "../components/ui.js";
import { openHref, Page } from "./page.js";

/**
 * History (#42): what was read on one day, latest first: issues opened, and peeks left open long
 * enough to count (#56), told apart as "Opened" and "Read". Earlier and later skip days with
 * nothing read; the day lives in the URL, so Back steps through the days visited.
 */
export function History({ day: asked, wide }: { day?: string; wide: boolean }) {
  const { api } = useApp();
  const { route } = useLocation();
  const today = readerDay(Date.now());
  const day = asked && isReaderDay(asked) && asked <= today ? asked : today;
  const history = useAsync(() => api.history(day), [day], `history:${day}`);
  useScrollMemory(history.status === "ok");
  const patch = (id: string, change: Partial<HistoryItem>) =>
    history.set((d) => ({ ...d, items: patchIssue(d.items, id, change) }));
  const items = history.data?.items ?? [];
  const before = history.data?.previousDay;
  const after = history.data?.nextDay;
  const go = (d: string) => route(historyHref(d === today ? undefined : d));
  const href = openHref(wide);

  return (
    <Page
      title="History"
      wide={wide}
      sub={`${dayLine(day)}${history.status === "ok" ? ` · ${items.length} read` : ""}`}
    >
      <nav class="days" aria-label="Days">
        <button
          type="button"
          class="btn line sm"
          disabled={!before}
          onClick={() => before && go(before)}
        >
          ‹ {before ? shortDay(before) : "Earlier"}
        </button>
        <input
          type="date"
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
          class="btn line sm"
          disabled={!after}
          onClick={() => after && go(after)}
        >
          {after ? shortDay(after) : "Later"} ›
        </button>
      </nav>
      {history.status === "loading" && <Skeleton />}
      {history.status === "error" && <Failed message={history.error} retry={history.reload} />}
      {history.status === "ok" && items.length === 0 && (
        <Empty title="Nothing read on this day.">
          {before && (
            <button type="button" class="btn line" onClick={() => go(before)}>
              Go to {dayLine(before)}
            </button>
          )}
        </Empty>
      )}
      <ul class="rows">
        {items.map((i) => (
          <Row
            key={i.id}
            issue={i}
            href={href(i)}
            onChange={patch}
            wide={wide}
            read={{ at: i.openedAt, via: i.via }}
          />
        ))}
      </ul>
    </Page>
  );
}
