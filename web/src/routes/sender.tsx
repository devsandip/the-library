import { useState } from "preact/hooks";
import { useRoute } from "preact-iso";
import type { IssueListItem, SenderPatch, Shelf } from "@library/core/types";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { BackIcon, StarIcon } from "../components/icons.js";
import { IssueCard } from "../components/issue-card.js";
import { IssueRow } from "../components/issue-row.js";
import { useSaveToggle } from "../components/save.js";
import { useSwipeRating } from "../components/swipe.js";
import { patchIssue } from "../groups.js";
import { useAsync } from "../hooks.js";
import { useMedia, WIDE } from "../media.js";

export function Sender() {
  const { api } = useApp();
  const { params } = useRoute();
  const senderId = params.senderId ?? "";
  const sender = useAsync(() => api.getSender(senderId), [senderId]);
  const wide = useMedia(WIDE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const patch = (id: string, change: Partial<IssueListItem>) =>
    sender.set((d) => ({ ...d, issues: patchIssue(d.issues, id, change) }));
  // Swipe to rate (#13). This page lists archived issues too, so swiped rows stay.
  const rating = useSwipeRating({ patch });
  const save = useSaveToggle(patch);

  const update = async (patch: SenderPatch) => {
    const before = sender.data;
    if (!before) return;
    const { shelf, ...flags } = patch;
    sender.set({ ...before, ...flags, ...("shelf" in patch ? { shelf: shelf ?? undefined } : {}) });
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
      <a class="back" href={`${BASE}/senders`}>
        <BackIcon /> Senders
      </a>
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
        <select
          aria-label="Shelf for this newsletter"
          value={s.shelf ?? ""}
          disabled={saving}
          onChange={(e) =>
            update({ shelf: ((e.target as HTMLSelectElement).value || null) as Shelf | null })
          }
        >
          <option value="">Claude decides each issue</option>
          <option value="news">Always News</option>
          <option value="learning">Always Learning</option>
        </select>
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
      ) : wide ? (
        <ul class="rows panel">
          {s.issues.map((i) => (
            <IssueRow key={i.id} issue={i} showPublication={false} onSave={save} />
          ))}
        </ul>
      ) : (
        <ul class="cards">
          {s.issues.map((i) => (
            <IssueCard
              key={i.id}
              issue={i}
              showPublication={false}
              swipe={rating.actions(i)}
              onSave={save}
            />
          ))}
        </ul>
      )}
      {!wide && rating.toast}
    </section>
  );
}
