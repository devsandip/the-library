import { useState } from "preact/hooks";
import { useRoute } from "preact-iso";
import type { SenderPatch } from "@library/core/types";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { StarIcon } from "../components/icons.js";
import { IssueRow } from "../components/issue-row.js";
import { useAsync } from "../hooks.js";

export function Sender() {
  const { api } = useApp();
  const { params } = useRoute();
  const senderId = params.senderId ?? "";
  const sender = useAsync(() => api.getSender(senderId), [senderId]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const update = async (patch: SenderPatch) => {
    const before = sender.data;
    if (!before) return;
    sender.set({ ...before, ...patch });
    setSaving(true);
    setError(undefined);
    try {
      await api.updateSender(senderId, patch);
    } catch (err) {
      sender.set(before);
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (sender.status === "loading") return <p class="muted">Loading...</p>;
  if (sender.status === "error") {
    return (
      <section>
        <p class="error">{sender.error}</p>
        <p>
          <a href={`${BASE}/senders`}>All senders</a>
        </p>
      </section>
    );
  }

  const s = sender.data;
  return (
    <section class="sender">
      <p class="muted">
        <a href={`${BASE}/senders`}>Senders</a>
      </p>
      <h1>{s.publication}</h1>
      <p class="muted">
        {s.issueCount} {s.issueCount === 1 ? "issue" : "issues"} · {s.up} Relevant · {s.down}{" "}
        Irrelevant
      </p>
      <p class="muted small">{s.addresses.join(", ")}</p>

      <div class="sender-actions">
        <button
          type="button"
          class={`star-toggle${s.mustRead ? " on" : ""}`}
          onClick={() => update({ mustRead: !s.mustRead })}
          disabled={saving}
          aria-pressed={s.mustRead}
        >
          <StarIcon filled={s.mustRead} />
          Must Read
        </button>
        <button
          type="button"
          onClick={() => update({ muted: !s.muted })}
          disabled={saving}
          aria-pressed={s.muted}
        >
          {s.muted ? "Unmute" : "Mute sender"}
        </button>
        {s.unsubscribeUrl && (
          <a href={s.unsubscribeUrl} target="_blank" rel="noopener noreferrer">
            Unsubscribe at source
          </a>
        )}
      </div>
      {s.mustRead && !s.muted && (
        <p class="muted small">Must Read: its unread issues come first on Home.</p>
      )}
      {s.muted && (
        <p class="muted small">Muted: new issues are kept but hidden from Unread and All.</p>
      )}
      {error && <p class="error">{error}</p>}

      <h2>Issues</h2>
      {s.issues.length === 0 ? (
        <p class="muted">No issues stored.</p>
      ) : (
        <ul class="issue-list">
          {s.issues.map((i) => (
            <IssueRow key={i.id} issue={i} showPublication={false} />
          ))}
        </ul>
      )}
    </section>
  );
}
