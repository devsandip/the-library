import { useEffect, useRef, useState } from "preact/hooks";
import type { IssueListItem, Rating, ReaderState, Shelf } from "@library/core/types";
import { ApiError } from "../api.js";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { homeHref, SHELF_LABEL } from "../filters.js";
import { relativeTime } from "../format.js";
import { useAsync } from "../hooks.js";
import { useLibrary } from "../library.js";
import { backIfPossible } from "../nav.js";
import { NewsletterFrame } from "./newsletter-frame.js";
import { useReadingPlace } from "./now-reading.js";
import { Related } from "./related.js";
import { ArchiveIcon, BackIcon, ExternalIcon, ThumbDown, ThumbUp, UnreadIcon } from "./icons.js";

/**
 * One issue: its header, the actions and the newsletter. Its own page on the phone (actions in
 * a bar at the bottom) and in the Mac's reading pane or page (a row of labelled buttons, with
 * Claude's summary in a box under the headline, #14).
 */
export function IssueReader({
  id,
  wide,
  standalone = false,
  onChange,
  onOpen,
}: {
  id: string;
  wide: boolean;
  /** Its own page, with a way back, rather than the pane beside a list. */
  standalone?: boolean;
  /** Tells the list beside the pane what changed, so its row keeps up. */
  onChange?: (id: string, patch: Partial<IssueListItem>) => void;
  /** Opens a related issue in the pane instead of on its own page. */
  onOpen?: (id: string) => void;
}) {
  const { api } = useApp();
  const { counts, nowReading } = useLibrary();
  const issue = useAsync(() => api.getIssue(id), [id]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const opened = useRef<string | undefined>(undefined);

  // A new issue starts at its top, in the pane or on its own page (a related link keeps the page).
  useEffect(() => {
    scrollTo(0, 0);
  }, [id]);

  // Opening marks the issue read (and logs the open) once per visit.
  useEffect(() => {
    const data = issue.data;
    if (!data || opened.current === data.id) return;
    opened.current = data.id;
    // The open also points Now reading at this issue (#44).
    void api.logOpen(data.id).then(nowReading.reload, () => undefined);
    if (data.state === "unread") {
      issue.set({ ...data, state: "read" });
      onChange?.(data.id, { state: "read" });
      void api.setState(data.id, "read").then(counts.reload, () => undefined);
    }
  }, [issue.data]);

  // Now reading (#44): back to the place in the issue, and the place saved while reading.
  const onFit = useReadingPlace(id, issue.data?.position, (issueId, place, keepalive) => {
    // The card in the sidebar keeps up; a finished issue leaves Now reading.
    nowReading.set((cur) => {
      const n = cur.nowReading;
      if (n?.issue.id !== issueId) return cur;
      return place >= 1
        ? {}
        : { nowReading: { ...n, position: place, at: new Date().toISOString() } };
    });
    const pointed = nowReading.data?.nowReading?.issue.id === issueId;
    void api.savePosition(issueId, place, keepalive).then(
      // A place saved in another issue moves Now reading to it.
      () => !pointed && place < 1 && nowReading.reload(),
      () => undefined,
    );
  });

  /** Optimistic update; on failure revert, and on a conflict show the fresh copy. */
  const change = async (patch: Partial<IssueListItem>, send: () => Promise<unknown>) => {
    const before = issue.data;
    if (!before || busy) return;
    issue.set({ ...before, ...patch });
    onChange?.(before.id, patch);
    setBusy(true);
    setNotice(undefined);
    try {
      await send();
      if ("state" in patch || "shelf" in patch) counts.reload();
      // Archiving or rating an issue ends Now reading on it.
      if ("state" in patch || "rating" in patch) nowReading.reload();
    } catch (err) {
      issue.set(before);
      const undo: Partial<IssueListItem> = {};
      for (const k of Object.keys(patch) as (keyof IssueListItem)[]) {
        Object.assign(undo, { [k]: before[k] });
      }
      onChange?.(before.id, undo);
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
      <section class="issue">
        <p class="error">{issue.error}</p>
        {standalone && (
          <p>
            <a href={`${BASE}/`}>Back to the Library</a>
          </p>
        )}
      </section>
    );
  }

  const d = issue.data;
  const other: Shelf = d.shelf === "learning" ? "news" : "learning";
  const archived = d.state === "archived";
  // The topic switches Home's chip on (#10); from a pane, the issue stays open beside the list.
  const topic = d.topic && (
    <a
      class="topic-link"
      href={homeHref({
        shelf: d.shelf ?? "news",
        view: "unread",
        senders: [],
        topics: [d.topic],
        issue: standalone ? undefined : d.id,
      })}
      title={`Only ${d.topic}`}
    >
      {d.topic}
    </a>
  );

  const thumbs = (
    <>
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
    </>
  );

  return (
    <article class={`issue${wide ? " wide" : ""}`}>
      <header class="issue-header">
        {standalone && (
          <a class="back" href={`${BASE}/`} onClick={backIfPossible}>
            <BackIcon /> Library
          </a>
        )}
        <p class="issue-publication">
          <a href={`${BASE}/senders/${d.senderId}`}>{d.publication}</a>
          {d.mustRead && <span class="must"> · Must Read</span>}
        </p>
        <h1>{d.subject}</h1>
        <p class="issue-meta">
          <time dateTime={d.receivedAt}>{relativeTime(d.receivedAt)}</time> · {d.readMinutes} min
          read
          {wide && d.shelf && ` · ${SHELF_LABEL[d.shelf]}`}
          {wide && topic && <> · {topic}</>}
        </p>
        {!wide && d.shelf && (
          <p class="muted shelf-line">
            {SHELF_LABEL[d.shelf]}
            {topic && <> · {topic}</>}
            {" · "}
            <button type="button" class="link" onClick={() => moveTo(other)} disabled={busy}>
              Move to {SHELF_LABEL[other]}
            </button>
          </p>
        )}
        {archived && d.autoArchived && (
          <p class="muted small">
            Archived automatically:{" "}
            {d.autoArchived === "promo"
              ? "Claude marked it as a promo."
              : "news left unread for a week."}
          </p>
        )}
        {wide && d.summary && (
          <div class="summary-box">
            <p class="summary-label">Claude's summary</p>
            <p class="summary-text">{d.summary}</p>
          </div>
        )}
      </header>

      {wide ? (
        <div class="reader-actions" role="toolbar" aria-label="Issue actions">
          {thumbs}
          <button
            type="button"
            class={`thumb${archived ? " on" : ""}`}
            aria-pressed={archived}
            title={archived ? "Move back to the inbox" : undefined}
            onClick={() => setState(archived ? "read" : "archived")}
          >
            <ArchiveIcon /> <span>Archive</span>
          </button>
          <button
            type="button"
            class="thumb"
            onClick={() => setState(d.state === "unread" ? "read" : "unread")}
          >
            <UnreadIcon /> <span>{d.state === "unread" ? "Mark read" : "Mark unread"}</span>
          </button>
          {d.shelf && (
            <button type="button" class="thumb" onClick={() => moveTo(other)} disabled={busy}>
              Move to {SHELF_LABEL[other]}
            </button>
          )}
          {d.viewOnlineUrl && (
            <a
              class="thumb primary"
              href={d.viewOnlineUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open original <ExternalIcon />
            </a>
          )}
        </div>
      ) : (
        <div class="action-bar" role="toolbar" aria-label="Issue actions">
          {thumbs}
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
            class={`icon${archived ? " on" : ""}`}
            title={archived ? "Move back to inbox" : "Archive"}
            aria-label={archived ? "Move back to inbox" : "Archive"}
            aria-pressed={archived}
            onClick={() => setState(archived ? "read" : "archived")}
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
      )}
      {notice && <p class="notice">{notice}</p>}

      <NewsletterFrame html={d.html} title={d.subject} onFit={onFit} />
      <Related id={d.id} onOpen={onOpen} />
    </article>
  );
}
