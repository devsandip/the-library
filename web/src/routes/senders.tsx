import { useState } from "preact/hooks";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { relativeTime } from "../format.js";
import { useAsync } from "../hooks.js";
import { backIfPossible } from "../nav.js";
import { BackIcon, StarIcon } from "../components/icons.js";

export function Senders() {
  const { api } = useApp();
  const senders = useAsync(() => api.listSenders(), []);
  // Stars toggled on this page, so quick taps on several rows never overwrite each other.
  const [stars, setStars] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>();

  const star = async (senderId: string, mustRead: boolean) => {
    setStars((m) => ({ ...m, [senderId]: mustRead }));
    setError(undefined);
    try {
      await api.updateSender(senderId, { mustRead });
    } catch (err) {
      setStars((m) => ({ ...m, [senderId]: !mustRead }));
      setError((err as Error).message);
    }
  };

  const items = senders.data?.items ?? [];
  const starred = items.filter((s) => stars[s.senderId] ?? s.mustRead).length;

  return (
    <section>
      <a class="back" href={`${BASE}/`} onClick={backIfPossible}>
        <BackIcon /> Library
      </a>
      <h1>Senders</h1>
      {senders.status === "loading" && <p class="muted">Loading...</p>}
      {senders.status === "error" && <p class="error">{senders.error}</p>}
      {senders.status === "ok" && items.length === 0 && (
        <p class="muted">No senders yet. They appear after the first Gmail check.</p>
      )}
      {items.length > 0 && (
        <>
          <p class="page-intro">
            Star the newsletters you never want to miss: their unread issues come first on Home.
            {starred > 0 && ` ${starred} of ${items.length} starred.`}
          </p>
          {error && <p class="error">{error}</p>}
          <ul class="card-list sender-list">
            {items.map((s) => {
              const on = stars[s.senderId] ?? s.mustRead;
              return (
                <li key={s.senderId} class={`sender-row${s.muted ? " muted-sender" : ""}`}>
                  <a href={`${BASE}/senders/${s.senderId}`}>
                    <span class="sender-name">{s.publication}</span>
                    <span class="meta">
                      {s.issueCount} {s.issueCount === 1 ? "issue" : "issues"}
                      {s.up > 0 && ` · ${s.up} Relevant`}
                      {s.down > 0 && ` · ${s.down} Irrelevant`}
                      {s.lastSeenAt && ` · last ${relativeTime(s.lastSeenAt)}`}
                      {s.muted && " · muted"}
                    </span>
                  </a>
                  <button
                    type="button"
                    class={`star-button${on ? " on" : ""}`}
                    aria-pressed={on}
                    aria-label={`Must Read: ${s.publication}`}
                    title={on ? "Must Read" : "Mark as Must Read"}
                    onClick={() => star(s.senderId, !on)}
                  >
                    <StarIcon filled={on} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
