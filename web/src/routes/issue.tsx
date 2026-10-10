import { useEffect, useRef, useState } from "preact/hooks";
import { useRoute } from "preact-iso";
import type { IssueDetailResponse, Rating, ReaderState, Shelf } from "@library/core/types";
import { ApiError } from "../api.js";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { relativeTime } from "../format.js";
import { useAsync } from "../hooks.js";
import { backIfPossible } from "../nav.js";
import { NewsletterFrame } from "../components/newsletter-frame.js";
import {
  ArchiveIcon,
  BackIcon,
  ExternalIcon,
  ThumbDown,
  ThumbUp,
  UnreadIcon,
} from "../components/icons.js";

export function Issue() {
  const { api } = useApp();
  const { params } = useRoute();
  const id = params.id ?? "";
  const issue = useAsync(() => api.getIssue(id), [id]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const opened = useRef<string | undefined>(undefined);

  // Opening marks the issue read (and logs the open) once per visit.
  useEffect(() => {
    const data = issue.data;
    if (!data || opened.current === data.id) return;
    opened.current = data.id;
    void api.logOpen(data.id).catch(() => undefined);
    if (data.state === "unread") {
      issue.set({ ...data, state: "read" });
      void api.setState(data.id, "read").catch(() => undefined);
    }
  }, [issue.data]);

  /** Optimistic update; on failure revert, and on a conflict show the fresh copy. */
  const change = async (patch: Partial<IssueDetailResponse>, send: () => Promise<unknown>) => {
    const before = issue.data;
    if (!before || busy) return;
    issue.set({ ...before, ...patch });
    setBusy(true);
    setNotice(undefined);
    try {
      await send();
    } catch (err) {
      issue.set(before);
      if (err instanceof ApiError && err.status === 409) {
        setNotice("This issue changed on another device. Showing the latest.");
        issue.reload();
      } else {
        setNotice((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const rate = (value: Rating) => {
    const next = issue.data?.rating === value ? 0 : value; // tap again to clear
    void change({ rating: next === 0 ? undefined : next }, () => api.rate(id, next));
  };
  const setState = (state: ReaderState) => void change({ state }, () => api.setState(id, state));
  const moveTo = (shelf: Shelf) => void change({ shelf }, () => api.setShelf(id, shelf));

  if (issue.status === "loading") return <p class="muted">Loading...</p>;
  if (issue.status === "error") {
    return (
      <section>
        <p class="error">{issue.error}</p>
        <p>
          <a href={`${BASE}/`}>Back to the Library</a>
        </p>
      </section>
    );
  }

  const d = issue.data;
  const other: Shelf = d.shelf === "learning" ? "news" : "learning";
  return (
    <article class="issue">
      <header class="issue-header">
        <a class="back" href={`${BASE}/`} onClick={backIfPossible}>
          <BackIcon /> Library
        </a>
        <p class="issue-publication">
          <a href={`${BASE}/senders/${d.senderId}`}>{d.publication}</a>
        </p>
        <h1>{d.subject}</h1>
        {d.summary && <p class="standfirst">{d.summary}</p>}
        <p class="issue-meta">
          <time dateTime={d.receivedAt}>{relativeTime(d.receivedAt)}</time> · {d.readMinutes} min
          read
        </p>
        {d.shelf && (
          <p class="muted shelf-line">
            {SHELF_LABEL[d.shelf]}
            {d.topic && ` · ${d.topic}`}
            {" · "}
            <button type="button" class="link" onClick={() => moveTo(other)} disabled={busy}>
              Move to {SHELF_LABEL[other]}
            </button>
          </p>
        )}
        {d.state === "archived" && d.autoArchived && (
          <p class="muted small">
            Archived automatically:{" "}
            {d.autoArchived === "promo"
              ? "Claude marked it as a promo."
              : "news left unread for a week."}
          </p>
        )}
      </header>

      <div class="action-bar" role="toolbar" aria-label="Issue actions">
        <button
          type="button"
          class={`thumb${d.rating === 1 ? " on up" : ""}`}
          aria-pressed={d.rating === 1}
          onClick={() => rate(1)}
        >
          <ThumbUp filled={d.rating === 1} /> <span>Relevant</span>
        </button>
        <button
          type="button"
          class={`thumb${d.rating === -1 ? " on down" : ""}`}
          aria-pressed={d.rating === -1}
          onClick={() => rate(-1)}
        >
          <ThumbDown filled={d.rating === -1} /> <span>Irrelevant</span>
        </button>
        <span class="spacer" />
        <button
          type="button"
          class="icon"
          title={d.state === "unread" ? "Mark read" : "Mark unread"}
          aria-label={d.state === "unread" ? "Mark read" : "Mark unread"}
          onClick={() => setState(d.state === "unread" ? "read" : "unread")}
        >
          <UnreadIcon />
        </button>
        <button
          type="button"
          class={`icon${d.state === "archived" ? " on" : ""}`}
          title={d.state === "archived" ? "Move back to inbox" : "Archive"}
          aria-label={d.state === "archived" ? "Move back to inbox" : "Archive"}
          aria-pressed={d.state === "archived"}
          onClick={() => setState(d.state === "archived" ? "read" : "archived")}
        >
          <ArchiveIcon />
        </button>
        {d.viewOnlineUrl && (
          <a
            class="icon button"
            href={d.viewOnlineUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open original"
            aria-label="Open original"
          >
            <ExternalIcon />
          </a>
        )}
      </div>
      {notice && <p class="notice">{notice}</p>}

      <NewsletterFrame html={d.html} title={d.subject} />
    </article>
  );
}

const SHELF_LABEL: Record<Shelf, string> = { news: "News", learning: "Learning" };
