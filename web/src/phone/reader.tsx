import { useEffect, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { IssueDetailResponse, IssueStory } from "@library/core/types";
import { storyRelated, useRelated, useStories } from "../data.js";
import { clock } from "../format.js";
import { goBack, previousPath } from "../nav.js";
import { BASE } from "../config.js";
import { issueHref, newsletterHref, slug, todayHref, type Deep } from "../paths.js";
import { useOpenIssue } from "../reader.js";
import { KIND_WORD } from "../sentence.js";
import { NewsletterFrame } from "../components/newsletter-frame.js";
import { isWebLink } from "../components/peek.js";
import { Thumbs } from "../components/thumbs.js";
import { namesLine, RelatedList } from "../components/story.js";
import { Failed, Skeleton } from "../components/ui.js";

/** Where the reader came from, for its way back: "‹ Today", "‹ Browse", "‹ Search". */
function fromLabel(path: string | undefined): string {
  const rel = path?.slice(BASE.length) ?? "";
  if (rel.startsWith("/browse")) return "Browse";
  if (rel.startsWith("/saved")) return "Saved";
  if (rel.startsWith("/library/search")) return "Search";
  if (rel.startsWith("/library/history")) return "History";
  if (rel.startsWith("/library/newsletters")) return "Newsletters";
  if (rel.startsWith("/library")) return "Library";
  if (rel.startsWith("/issue")) return "Back";
  return "Today";
}

/**
 * Reading an issue on the phone (P4): a way back and the original on top, the issue's header,
 * then the newsletter's own page, never recoloured, scaled to the column. The action bar at the
 * bottom: thumbs up and down (was it useful?), Save, Archive, and the stories of a digest. A story
 * opens as a sheet over the page.
 */
export function Reader({ id, story, deep }: { id: string; story?: number; deep?: Deep }) {
  const { route } = useLocation();
  const [from] = useState(() => {
    const prev = previousPath();
    // Opened from its own story sheet's URL: the way back is still where the reader came from.
    return fromLabel(prev?.startsWith(issueHref(id)) ? undefined : prev);
  });
  const { issue, onFit, actions } = useOpenIssue(id);
  const stories = useStories(id).data?.stories ?? [];
  const digest = stories.length > 1;

  const openStory = (n: number) => route(issueHref(id, n));

  if (issue.status === "loading") {
    return (
      <article class="reader">
        <div class="top-bar">
          <button type="button" class="back" onClick={() => goBack(route, todayHref())}>
            ‹ {from}
          </button>
        </div>
        <Skeleton rows={2} />
      </article>
    );
  }
  if (issue.status === "error") {
    return (
      <article class="reader">
        <div class="top-bar">
          <button type="button" class="back" onClick={() => goBack(route, todayHref())}>
            ‹ {from}
          </button>
        </div>
        <Failed message={issue.error} />
        <p class="center">
          <a class="btn line" href={todayHref()}>
            Back to Nutgraf
          </a>
        </p>
      </article>
    );
  }

  const d = issue.data;
  const archived = d.state === "archived";
  const saved = d.savedAt !== undefined;
  const kind = d.shelf ?? "news";

  return (
    <article class="reader">
      <div class="top-bar">
        <button type="button" class="back" onClick={() => goBack(route, todayHref())}>
          ‹ {from}
        </button>
        {d.viewOnlineUrl && (
          <a
            class="top-link label"
            href={d.viewOnlineUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Original ↗
          </a>
        )}
      </div>
      <header class="reader-head">
        <p class="reader-meta label">
          <a href={newsletterHref(slug(d.publication))}>{d.publication}</a> · {clock(d.receivedAt)}{" "}
          · {d.readMinutes} min ·{" "}
          <button
            type="button"
            class="kind-switch"
            aria-label={`${KIND_WORD[kind]}. Move to ${kind === "news" ? "Learning" : "News"}`}
            onClick={() => actions.move(d)}
          >
            {KIND_WORD[kind]}
          </button>
          {d.topic && ` · ${d.topic}`}
        </p>
        <h1 class="issue-title">{d.subject}</h1>
        {digest ? (
          <button type="button" class="inside-btn label" onClick={() => openStory(1)}>
            {stories.length} stories inside ›
          </button>
        ) : (
          stories.length === 1 && (
            <button type="button" class="inside-btn label" onClick={() => openStory(1)}>
              Go deeper on this story ›
            </button>
          )
        )}
        {archived && d.autoArchived && (
          <p class="reader-note">
            Archived automatically:{" "}
            {d.autoArchived === "promo"
              ? "Claude marked it as a promo."
              : "news left unread for a week."}
          </p>
        )}
      </header>

      <div class="page">
        <NewsletterFrame html={d.html} title={d.subject} onFit={onFit} />
      </div>

      <div class="action-bar" role="toolbar" aria-label="Issue actions">
        <Thumbs issue={d} actions={actions} class="act thumb" />
        <button
          type="button"
          class={`act${saved ? " on" : ""}`}
          aria-pressed={saved}
          disabled={archived}
          onClick={() => actions.save(d)}
        >
          {saved ? "Saved" : "Save"}
        </button>
        <button
          type="button"
          class={`act${archived ? " on" : ""}`}
          aria-pressed={archived}
          onClick={() => actions.archive(d)}
        >
          {archived ? "Archived" : "Archive"}
        </button>
        {digest && (
          <button type="button" class="act" onClick={() => openStory(1)}>
            Stories {stories.length}
          </button>
        )}
      </div>

      {story !== undefined && stories.length > 0 && (
        <StorySheet
          issue={d}
          stories={stories}
          n={Math.min(story, stories.length)}
          deep={deep}
          onStep={(n) => route(issueHref(id, n), true)}
          onClose={() => {
            if (previousPath() === issueHref(id)) history.back();
            else route(issueHref(id), true);
          }}
        />
      )}
    </article>
  );
}

/** The sheet sits at one of two heights: over the lower part of the page, or the whole screen. */
type Detent = "medium" | "full";

/**
 * One story of the issue (P4, P5): ‹ › step through the stories, its headline and what it says,
 * who it names and where else it ran, its source, and its related stories from before and since.
 * Drag the grabber between the two heights (down from the lower one closes it); tap the scrim to
 * close.
 */
function StorySheet({
  issue,
  stories,
  n,
  onStep,
  onClose,
}: {
  issue: IssueDetailResponse;
  stories: IssueStory[];
  n: number;
  deep?: Deep;
  onStep: (n: number) => void;
  onClose: () => void;
}) {
  const { route } = useLocation();
  const [detent, setDetent] = useState<Detent>("medium");
  const sheet = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const relatedRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; pointer: number; dy: number } | undefined>(undefined);
  const related = useRelated(issue.id);
  const s = stories.find((x) => x.n === n) ?? stories[0]!;
  const digest = stories.length > 1;
  const rel = storyRelated(related.data, s.n, digest);
  const relCount = rel.earlier.length + rel.since.length;
  const names = namesLine(s, [...rel.earlier, ...rel.since], issue.publication);

  // A new story starts at its top.
  useEffect(() => {
    body.current?.scrollTo(0, 0);
  }, [n]);

  // The page under the sheet stays still.
  useEffect(() => {
    document.documentElement.classList.add("sheet-open");
    return () => document.documentElement.classList.remove("sheet-open");
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  const onGrab = (e: PointerEvent) => {
    drag.current = { y: e.clientY, pointer: e.pointerId, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onGrabMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    d.dy = e.clientY - d.y;
    if (sheet.current) {
      sheet.current.style.transition = "none";
      sheet.current.style.transform = `translateY(${Math.max(d.dy, detent === "full" ? 0 : -180)}px)`;
    }
  };
  const onGrabEnd = () => {
    const d = drag.current;
    drag.current = undefined;
    if (sheet.current) {
      sheet.current.style.transition = "";
      sheet.current.style.transform = "";
    }
    if (!d) return;
    if (Math.abs(d.dy) < 6) setDetent(detent === "full" ? "medium" : "full");
    else if (d.dy < -60) setDetent("full");
    else if (d.dy > 80) {
      if (detent === "full") setDetent("medium");
      else onClose();
    }
  };

  const showRelated = () => {
    setDetent("full");
    requestAnimationFrame(() =>
      relatedRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
  };

  return (
    <div class="story-layer" onKeyDown={onKey}>
      <div class="scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheet}
        class={`story-sheet ${detent}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Story ${s.n} of ${stories.length}: ${s.headline}`}
      >
        <div
          class="grab-zone"
          onPointerDown={onGrab}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabEnd}
          onPointerCancel={onGrabEnd}
        >
          <span class="grabber" aria-hidden="true" />
        </div>
        <div class="sheet-body" ref={body}>
          <div class="story-bar">
            <span class="label">
              {detent === "full" && `${issue.publication} · `}
              {digest ? `Story ${s.n} of ${stories.length}` : "This story"}
            </span>
            {digest && (
              <span class="steppers">
                <button
                  type="button"
                  aria-label="Previous story"
                  disabled={s.n <= 1}
                  onClick={() => onStep(s.n - 1)}
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Next story"
                  disabled={s.n >= stories.length}
                  onClick={() => onStep(s.n + 1)}
                >
                  ›
                </button>
              </span>
            )}
            <button type="button" class="sr-only" onClick={onClose}>
              Close
            </button>
          </div>
          <h2 class="story-headline">{s.headline}</h2>
          <p class="story-summary">{s.summary}</p>
          {names && <p class="story-names label">{names}</p>}
          <div class="story-actions">
            {isWebLink(s.link) ? (
              <a class="btn line caps" href={s.link} target="_blank" rel="noopener noreferrer">
                Source ↗
              </a>
            ) : (
              <button type="button" class="btn line caps" disabled>
                No source link
              </button>
            )}
            <button type="button" class="btn line caps" onClick={showRelated}>
              Related {related.status === "ok" ? relCount : "…"}
            </button>
          </div>
          <div class="story-related" ref={relatedRef}>
            <p class="label section-label">Related, before and since</p>
            {related.status === "loading" && <p class="related-none">Looking…</p>}
            {related.status === "error" && <p class="related-none">{related.error}</p>}
            {related.status === "ok" && (
              <RelatedList
                earlier={rel.earlier}
                since={rel.since}
                href={(id) => issueHref(id)}
                onOpen={(id) => route(issueHref(id))}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
