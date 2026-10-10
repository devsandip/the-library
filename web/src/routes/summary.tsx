import { useState } from "preact/hooks";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { useAsync } from "../hooks.js";
import { backIfPossible } from "../nav.js";
import { ArchiveIcon, BackIcon, StarIcon } from "../components/icons.js";

/** Skimming one-line summaries runs at about 200 words a minute. */
function skimMinutes(lines: string[]): number {
  const words = lines.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** The 20 most relevant unread News issues, best first (#11). */
export function Summary() {
  const { api } = useApp();
  const summary = useAsync(() => api.summary(), []);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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
  const date = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const minutes = skimMinutes(items.map((i) => i.summary ?? i.subject));

  return (
    <section class="summary">
      <a class="back" href={`${BASE}/`} onClick={backIfPossible}>
        <BackIcon /> Library
      </a>
      <h1>Summary</h1>
      {summary.status === "loading" && <p class="subline">Ranking today's news...</p>}
      {summary.status === "error" && (
        <p class="error">
          {summary.error}{" "}
          <button type="button" class="link" onClick={summary.reload}>
            Retry
          </button>
        </p>
      )}
      {summary.status === "ok" && (
        <p class="subline">
          {date}
          {items.length > 0 &&
            ` · ${items.length < candidates ? `top ${items.length} of ${candidates}` : candidates} unread in News · about ${minutes} ${minutes === 1 ? "minute" : "minutes"} to skim`}
        </p>
      )}
      {error && <p class="error">{error}</p>}
      {summary.status === "ok" && items.length === 0 && (
        <div class="empty">
          <p class="empty-title">No new numbers.</p>
          <p class="muted">No unread news right now. New issues arrive every two hours.</p>
        </div>
      )}
      {items.length > 0 && (
        <>
          <ol class="card-list summary-list">
            {items.map((i) => (
              <li class="summary-row" key={i.id}>
                <a href={`${BASE}/issue/${encodeURIComponent(i.id)}`}>
                  <span class="publication">
                    {i.publication}
                    {i.mustRead && (
                      <span class="star" title="Must Read" aria-label="Must Read">
                        <StarIcon filled />
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
            ))}
          </ol>
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
    </section>
  );
}
