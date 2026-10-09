import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { relativeTime } from "../format.js";
import { useAsync } from "../hooks.js";

export function Senders() {
  const { api } = useApp();
  const senders = useAsync(() => api.listSenders(), []);

  return (
    <section>
      <h1>Senders</h1>
      {senders.status === "loading" && <p class="muted">Loading...</p>}
      {senders.status === "error" && <p class="error">{senders.error}</p>}
      {senders.status === "ok" && senders.data.items.length === 0 && (
        <p class="muted">No senders yet. They appear after the first Gmail check.</p>
      )}
      {senders.status === "ok" && senders.data.items.length > 0 && (
        <ul class="sender-list">
          {senders.data.items.map((s) => (
            <li key={s.senderId} class={s.muted ? "muted-sender" : ""}>
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
