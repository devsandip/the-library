import { useState } from "preact/hooks";
import type { IssueListItem, SenderPatch, Shelf } from "@library/core/types";
import { useApp } from "../context.js";
import { patchIssue } from "../data.js";
import { age } from "../format.js";
import { useAsync } from "../hooks.js";
import { useLibrary } from "../library.js";
import {
  browseHref,
  DEFAULT_BROWSE,
  DEFAULT_QUEUE,
  newsletterHref,
  newslettersHref,
  queueHref,
} from "../paths.js";
import { senderIds, senderSlug } from "../sentence.js";
import { Row } from "../components/row.js";
import { Empty, Failed, Skeleton } from "../components/ui.js";
import { openHref, Page } from "./page.js";

/**
 * Newsletters: every sender, with how it has been rated. A star makes it Must Read: its unread
 * issues come first in Browse and carry ★, and the ranking leans on it.
 */
export function Newsletters({ wide }: { wide: boolean }) {
  const { api } = useApp();
  const { senders } = useLibrary();
  // Stars toggled here, so quick taps on several rows never overwrite each other.
  const [stars, setStars] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>();
  const items = senders.data?.items ?? [];
  const starred = items.filter((s) => stars[s.senderId] ?? s.mustRead).length;

  const star = async (senderId: string, mustRead: boolean) => {
    setStars((m) => ({ ...m, [senderId]: mustRead }));
    setError(undefined);
    try {
      await api.updateSender(senderId, { mustRead });
      senders.reload();
    } catch (err) {
      setStars((m) => ({ ...m, [senderId]: !mustRead }));
      setError((err as Error).message);
    }
  };

  return (
    <Page
      title="Newsletters"
      wide={wide}
      sub={items.length ? `${items.length} · ${starred} ★ Must Read` : undefined}
    >
      {senders.status === "loading" && <Skeleton />}
      {senders.status === "error" && <Failed message={senders.error} retry={senders.reload} />}
      {senders.status === "ok" && items.length === 0 && (
        <Empty title="No newsletters yet.">
          <p class="empty-text">They appear after the first Gmail check.</p>
        </Empty>
      )}
      {error && <p class="error-line">{error}</p>}
      <ul class="group">
        {items.map((s) => {
          const on = stars[s.senderId] ?? s.mustRead;
          return (
            <li key={s.senderId} class={`group-row sender${s.muted ? " muted" : ""}`}>
              <a class="sender-link" href={newsletterHref(senderSlug(s))}>
                <span class="group-name">{s.publication}</span>
                <span class="label">
                  {s.issueCount} {s.issueCount === 1 ? "issue" : "issues"}
                  {s.up > 0 && ` · ${s.up} ✓`}
                  {s.down > 0 && ` · ${s.down} ✕`}
                  {s.lastSeenAt && ` · ${age(s.lastSeenAt)}`}
                  {s.muted && " · muted"}
                </span>
              </a>
              <button
                type="button"
                class={`star${on ? " on" : ""}`}
                aria-pressed={on}
                aria-label={`Must Read: ${s.publication}`}
                onClick={() => star(s.senderId, !on)}
              >
                ★
              </button>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}

/** One newsletter: Must Read, mute, always News or Learning, unsubscribe, and its issues. */
export function Newsletter({ slug, wide }: { slug: string; wide: boolean }) {
  const { api } = useApp();
  const { senders } = useLibrary();
  const id = senderIds([slug], senders.data?.items ?? [])[0];
  const known = senders.status !== "loading";
  const sender = useAsync(
    () => (id ? api.getSender(id) : Promise.reject(new Error(known ? "No such newsletter." : "…"))),
    [id, known],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const patch = (issueId: string, change: Partial<IssueListItem>) =>
    sender.set((d) => ({ ...d, issues: patchIssue(d.issues, issueId, change) }));
  const href = openHref(wide);

  const update = async (p: SenderPatch) => {
    const before = sender.data;
    if (!before) return;
    const { shelf, ...flags } = p;
    sender.set({ ...before, ...flags, ...("shelf" in p ? { shelf: shelf ?? undefined } : {}) });
    setSaving(true);
    setError(undefined);
    try {
      await api.updateSender(before.senderId, p);
      senders.reload();
    } catch (err) {
      sender.set(before);
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!known || sender.status === "loading") {
    return (
      <Page title="Newsletter" back="Newsletters" backTo={newslettersHref()} wide={wide}>
        <Skeleton />
      </Page>
    );
  }
  if (sender.status === "error") {
    return (
      <Page title="Newsletter" back="Newsletters" backTo={newslettersHref()} wide={wide}>
        <Failed message={sender.error} />
        <a class="btn line" href={newslettersHref()}>
          All newsletters
        </a>
      </Page>
    );
  }

  const s = sender.data;
  const listHref = wide
    ? queueHref(s.shelf ?? "news", { ...DEFAULT_QUEUE, order: "newest", senders: [slug] })
    : browseHref({ ...DEFAULT_BROWSE, kind: s.shelf ?? "news", senders: [slug] });
  return (
    <Page
      title={s.publication}
      back="Newsletters"
      backTo={newslettersHref()}
      wide={wide}
      sub={`${s.issueCount} ${s.issueCount === 1 ? "issue" : "issues"} · ${s.up} useful · ${s.down} not useful`}
    >
      <p class="sender-addr label">{s.addresses.join(", ")}</p>
      <div class="sender-actions">
        <button
          type="button"
          class={`btn line${s.mustRead ? " on" : ""}`}
          aria-pressed={s.mustRead}
          disabled={saving}
          onClick={() => update({ mustRead: !s.mustRead })}
        >
          {s.mustRead ? "★ Must Read" : "☆ Must Read"}
        </button>
        <button
          type="button"
          class={`btn line${s.muted ? " on" : ""}`}
          aria-pressed={s.muted}
          disabled={saving}
          onClick={() => update({ muted: !s.muted })}
        >
          {s.muted ? "Muted" : "Mute"}
        </button>
        <select
          class="btn line"
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
        <a class="btn line" href={listHref}>
          Unread from it
        </a>
        {s.unsubscribeUrl && (
          <a class="btn line" href={s.unsubscribeUrl} target="_blank" rel="noopener noreferrer">
            Unsubscribe ↗
          </a>
        )}
      </div>
      <p class="sender-note">
        {s.muted
          ? "Muted: new issues are kept, and left out of lists, counts and Today."
          : s.mustRead
            ? "Must Read: its unread issues come first, with ★."
            : ""}
      </p>
      {error && <p class="error-line">{error}</p>}
      <p class="label section-label">Issues</p>
      {s.issues.length === 0 && <p class="empty-text">No issues stored.</p>}
      <ul class="rows">
        {s.issues.map((i) => (
          <Row
            key={i.id}
            issue={i}
            href={href(i)}
            onChange={patch}
            wide={wide}
            showPublication={false}
          />
        ))}
      </ul>
    </Page>
  );
}
