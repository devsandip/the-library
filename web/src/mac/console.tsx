import { useEffect, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { IssueDetailResponse, IssueStory, Narrative } from "@library/core/types";
import type { IssueActions } from "../actions.js";
import { storyRelated, tally, useRelated, useStories } from "../data.js";
import { clock, dateShort, narrativeLine } from "../format.js";
import { useLibrary } from "../library.js";
import { PANES, useMedia } from "../media.js";
import {
  DEFAULT_QUEUE,
  historyHref,
  newslettersHref,
  queueHref,
  searchHref,
  settingsHref,
  statusHref,
  type QueueFilters,
  type QueueTab,
  type Screen,
} from "../paths.js";
import { useOpenIssue } from "../reader.js";
import { useTheme } from "../theme.js";
import { health } from "../phone/library-home.js";
import { ThumbIcon } from "../components/icons.js";
import { NewsletterFrame } from "../components/newsletter-frame.js";
import { ContinueItem } from "../components/now-reading.js";
import { isWebLink } from "../components/peek.js";
import { namesLine, RelatedList } from "../components/story.js";
import { useToast } from "../components/toast.js";
import { Failed, Skeleton } from "../components/ui.js";
import { QueuePane, useQueue } from "./queue.js";
import { Palette } from "./palette.js";

const TABS: { id: QueueTab; label: string }[] = [
  { id: "news", label: "News" },
  { id: "learning", label: "Learning" },
  { id: "saved", label: "Saved" },
];

/** Keys typed into a field are the field's. */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && Boolean(t.closest("input, textarea, select, [contenteditable]"));

/** The 24 px logo: the folded page (a corner turned down over an n), then the wordmark. */
function Logo() {
  return (
    <a class="logo" href={queueHref("news")} aria-label="Nutgraf: News">
      <span class="logo-tile" aria-hidden="true">
        <span class="logo-fold" />n
      </span>
      <span class="logo-name">nutgraf</span>
    </a>
  );
}

/**
 * The Mac (M1): a console of three panes under a 48 px top bar, driven by the keyboard. The queue
 * on the left, the reader in the middle, the issue's stories on the right; the status line at the
 * bottom keeps the keys, messages and the Continue item. Library's pages open in the same frame
 * from ⌘K. Below 1100 px the story index slides over from the right, opened with [.
 */
export function Console({ screen, page }: { screen: Screen; page?: preact.ComponentChildren }) {
  const { route } = useLocation();
  const lib = useLibrary();
  const toast = useToast();
  const panes = useMedia(PANES);
  const [palette, setPalette] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [peek, setPeek] = useState<string>();

  const isQueue = screen.name === "queue" || screen.name === "saved";
  const tab: QueueTab =
    screen.name === "queue" ? screen.tab : screen.name === "saved" ? "saved" : "news";
  const filters: QueueFilters = screen.name === "queue" ? screen.filters : DEFAULT_QUEUE;
  const selected = screen.name === "queue" ? screen.id : undefined;
  const storyN = screen.name === "queue" ? screen.story : undefined;

  const queue = useQueue(tab, filters);
  const s = lib.status.data;
  const h = health(s);
  const senders = lib.senders.data?.items ?? [];
  const count = (t: QueueTab) =>
    t === "saved"
      ? lib.counts.data?.saved
      : tally(lib.counts.data, senders, { shelf: t, topics: [], senders: [] })?.total;

  // Keys see the latest of everything without re-binding.
  const state = useRef({ queue, selected, storyN, tab, filters, peek, palette, indexOpen, panes });
  state.current = { queue, selected, storyN, tab, filters, peek, palette, indexOpen, panes };
  const reader = useRef<{
    issue?: IssueDetailResponse;
    stories: IssueStory[];
    actions?: IssueActions;
  }>({
    stories: [],
  });

  const select = (id: string, n?: number) => route(queueHref(tab, filters, id, n), true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = state.current;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (st.palette || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const items = st.queue.items;
      const at = items.findIndex((q) => q.issue.id === st.selected);
      const { issue, stories, actions } = reader.current;
      const n = st.storyN ?? 1;
      const step = (by: number) => {
        const next = items[at === -1 ? (by > 0 ? 0 : items.length - 1) : at + by];
        if (next) {
          setPeek(undefined);
          route(queueHref(st.tab, st.filters, next.issue.id), true);
        }
      };
      const story = (by: number) => {
        if (!st.selected || !stories.length) return;
        const to = Math.min(Math.max(n + by, 1), stories.length);
        route(queueHref(st.tab, st.filters, st.selected, to), true);
      };
      const k = e.key;
      const handled = (() => {
        switch (k) {
          case "j":
          case "ArrowDown":
            step(1);
            return true;
          case "k":
          case "ArrowUp":
            step(-1);
            return true;
          case "[":
            if (!st.panes && !st.indexOpen) setIndexOpen(true);
            else story(-1);
            return true;
          case "]":
            if (!st.panes && !st.indexOpen) setIndexOpen(true);
            else story(1);
            return true;
          case " ":
            if (st.selected) setPeek(st.peek === st.selected ? undefined : st.selected);
            return Boolean(st.selected);
          case "Escape":
            setPeek(undefined);
            setIndexOpen(false);
            return true;
          case "/":
            setPalette(true);
            return true;
          case "1":
          case "2":
          case "3":
            route(queueHref(TABS[Number(k) - 1]!.id));
            return true;
          case "u":
            if (!toast.undo()) toast.say("Nothing to undo");
            return true;
        }
        if (!issue || !actions) return false;
        switch (k) {
          case "y":
            actions.useful(issue);
            return true;
          case "n":
            actions.notUseful(issue);
            return true;
          case "s":
            if (issue.state === "archived") toast.say("Archived issues cannot be saved");
            else actions.save(issue);
            return true;
          case "e":
            actions.archive(issue);
            return true;
          case "m":
            actions.move(issue);
            return true;
          case "o": {
            const link = stories.find((x) => x.n === n)?.link;
            const url = isWebLink(link) ? link : issue.viewOnlineUrl;
            if (url) window.open(url, "_blank", "noopener,noreferrer");
            return true;
          }
        }
        return false;
      })();
      if (handled) e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div class={`console${panes ? "" : " narrow"}`}>
      <header class="console-top">
        <Logo />
        <nav class="tabs" aria-label="Queues">
          {TABS.map((t, k) => (
            <a
              key={t.id}
              class={`tab${isQueue && tab === t.id ? " on" : ""}`}
              href={queueHref(t.id)}
              aria-current={isQueue && tab === t.id ? "page" : undefined}
              title={`${t.label} (${k + 1})`}
            >
              {t.label} <span class="n">{count(t.id) ?? ""}</span>
            </a>
          ))}
        </nav>
        <span class="spacer" />
        <button type="button" class="command" onClick={() => setPalette(true)}>
          <span class="keycap">⌘K</span>
          <span>Search, ask, or go to History, Newsletters, Status…</span>
        </button>
        <a class="health label" href={statusHref()} title={h.word}>
          {h.tone && <span class={`dot ${h.tone}`} aria-hidden="true" />}
          {h.at ?? h.word}
        </a>
      </header>

      {isQueue ? (
        <div class="console-panes">
          <QueuePane
            tab={tab}
            filters={filters}
            queue={queue}
            selected={selected}
            peek={peek}
            onPeek={setPeek}
          />
          <main class="reader-pane">
            {selected ? (
              <MacReader
                key={selected}
                id={selected}
                tab={tab}
                rank={queue.items.find((q) => q.issue.id === selected)}
                onChange={queue.patch}
                bind={(r) => (reader.current = r)}
                onStories={() => setIndexOpen(true)}
                narrow={!panes}
              />
            ) : tab === "news" && queue.summary?.narrative ? (
              <BriefPane narrative={queue.summary.narrative} onOpen={(id) => select(id)} />
            ) : (
              <div class="reader-empty">
                <p class="empty-title">Pick an issue.</p>
                <p class="label">J and K move through the queue · opening one marks it read</p>
              </div>
            )}
          </main>
          {(panes || indexOpen) && (
            <aside class={`index-pane${panes ? "" : " over"}`} aria-label="In this issue">
              {selected ? (
                <StoryIndex
                  key={selected}
                  id={selected}
                  publication={queue.items.find((q) => q.issue.id === selected)?.issue.publication}
                  n={storyN}
                  onPick={(n) => select(selected, n)}
                  onOpen={(id) => route(queueHref(tab, filters, id))}
                  onClose={panes ? undefined : () => setIndexOpen(false)}
                />
              ) : (
                <p class="label index-none">Stories show here for the open issue.</p>
              )}
            </aside>
          )}
        </div>
      ) : (
        <main class="console-page">{page}</main>
      )}

      <footer class="status-line label">
        {toast.current ? (
          <span class="status-msg">
            {toast.current.text}
            {toast.current.action && (
              <button type="button" class="status-action" onClick={toast.current.action.run}>
                {toast.current.action.label}
              </button>
            )}
          </span>
        ) : (
          <span class="keys">
            <span>J/K issues</span>
            <span>[ ] stories</span>
            <span>Space peek</span>
            <span>Y useful</span>
            <span>N not useful</span>
            <span>S save</span>
            <span>E archive</span>
            <span>U undo</span>
            <span>/ search</span>
          </span>
        )}
        <span class="spacer" />
        <ContinueItem />
      </footer>

      <Palette
        open={palette}
        onClose={() => setPalette(false)}
        commands={[
          { label: "News", hint: "1", href: queueHref("news") },
          { label: "Learning", hint: "2", href: queueHref("learning") },
          { label: "Saved", hint: "3", href: queueHref("saved") },
          { label: "The day in brief", hint: "News", href: queueHref("news") },
          { label: "History", hint: "What you read", href: historyHref() },
          { label: "Newsletters", hint: "Stars and mutes", href: newslettersHref() },
          { label: "Status", hint: h.at ? `${h.word} · ${h.at}` : h.word, href: statusHref() },
          { label: "Settings", hint: "Theme", href: settingsHref() },
        ]}
        search={(q) => searchHref(q)}
      />
    </div>
  );
}

/** With nothing open, News shows the day in brief in the reader (#18). */
function BriefPane({
  narrative: n,
  onOpen,
}: {
  narrative: Narrative;
  onOpen: (id: string) => void;
}) {
  return (
    <div class="brief-pane">
      <p class="label box-text">
        In brief · {n.threads.length} threads · {clock(n.at)}
      </p>
      <h1 class="issue-title">The day, before you start</h1>
      <p class="label">{narrativeLine(n)}</p>
      {n.threads.map((t) => (
        <article class="thread" key={t.title}>
          <h2>{t.title}</h2>
          <p>{t.text}</p>
          <p class="thread-sources label">
            {t.sources.map((src, k) => (
              <span key={src.issueId}>
                {k > 0 && " · "}
                <button type="button" class="link-btn" onClick={() => onOpen(src.issueId)}>
                  {src.publication}
                </button>
              </span>
            ))}
          </p>
        </article>
      ))}
      <p class="label">Pick an issue to read it here · J starts at the top</p>
    </div>
  );
}

function MacReader({
  id,
  tab,
  rank,
  onChange,
  bind,
  onStories,
  narrow,
}: {
  id: string;
  tab: QueueTab;
  rank?: { rank: number; five: boolean };
  onChange: (id: string, change: Partial<IssueDetailResponse>) => void;
  bind: (r: { issue?: IssueDetailResponse; stories: IssueStory[]; actions?: IssueActions }) => void;
  onStories: () => void;
  narrow: boolean;
}) {
  const { route } = useLocation();
  const { dark } = useTheme();
  const { issue, onFit, actions } = useOpenIssue(id, onChange);
  const stories = useStories(id).data?.stories ?? [];
  bind({ issue: issue.data, stories, actions });

  // The console opens an issue under News until it knows the issue's shelf.
  useEffect(() => {
    const d = issue.data;
    if (!d || tab === "saved") return;
    const shelf = d.shelf ?? "news";
    if (shelf !== tab) route(queueHref(shelf, DEFAULT_QUEUE, d.id), true);
  }, [issue.data?.id]);

  if (issue.status === "loading") return <Skeleton rows={2} />;
  if (issue.status === "error") return <Failed message={issue.error} />;
  const d = issue.data;
  const archived = d.state === "archived";
  const saved = d.savedAt !== undefined;
  const meta = [
    rank?.five ? `${String(rank.rank).padStart(2, "0")} of today's five` : undefined,
    d.publication + (d.mustRead ? " ★" : ""),
    `${dateShort(new Date(d.receivedAt))} ${clock(d.receivedAt)}`,
    `${d.readMinutes} min`,
    (d.shelf ?? "news") === "news" ? "News" : "Learning",
    d.topic,
  ].filter(Boolean);

  const key = (
    k: string,
    label: string,
    on: boolean,
    run: () => void,
    tone = "",
    disabled = false,
    icon?: preact.ComponentChildren,
  ) => (
    <button
      type="button"
      class={`keybtn ${tone}${on ? " on" : ""}`}
      aria-pressed={on}
      aria-keyshortcuts={k}
      disabled={disabled}
      onClick={run}
    >
      <span class="k">{k}</span>
      {icon}
      {label}
    </button>
  );

  return (
    <article class="mac-reader">
      <p class="label reader-meta">{meta.join(" · ")}</p>
      <h1 class="issue-title">{d.subject}</h1>
      {d.summary && (
        <div class="summary-panel">
          <p class="label">Summary{d.scoreReason ? ` · Why: ${d.scoreReason}` : ""}</p>
          <p>{d.summary}</p>
        </div>
      )}
      {archived && d.autoArchived && (
        <p class="reader-note">
          Archived automatically:{" "}
          {d.autoArchived === "promo"
            ? "Claude marked it as a promo."
            : "news left unread for a week."}
        </p>
      )}
      <div class="keybtns" role="toolbar" aria-label="Issue actions">
        {key(
          "Y",
          "Useful",
          d.rating === 1,
          () => actions.useful(d),
          "rel",
          false,
          <ThumbIcon size={14} />,
        )}
        {key(
          "N",
          "Not useful",
          d.rating === -1,
          () => actions.notUseful(d),
          "irr",
          false,
          <ThumbIcon down size={14} />,
        )}
        {key("S", saved ? "Saved" : "Save", saved, () => actions.save(d), "", archived)}
        {key("E", archived ? "Archived" : "Archive", archived, () => actions.archive(d))}
        {key("M", (d.shelf ?? "news") === "news" ? "To Learning" : "To News", false, () =>
          actions.move(d),
        )}
        {d.viewOnlineUrl && (
          <a class="keybtn" href={d.viewOnlineUrl} target="_blank" rel="noopener noreferrer">
            <span class="k">O</span>Original ↗
          </a>
        )}
        {narrow && stories.length > 0 && (
          <button type="button" class="keybtn" onClick={onStories}>
            <span class="k">[</span>Stories {stories.length}
          </button>
        )}
      </div>
      <p class="label page-label">
        The newsletter's own page · sandboxed{dark ? " · dimmed 6% at night" : ""}
      </p>
      <div class="page">
        <NewsletterFrame html={d.html} title={d.subject} onFit={onFit} />
      </div>
    </article>
  );
}

/**
 * The story index (M1): the issue's stories, the selected one open in the ink box with its keys,
 * who it names, where else it ran and its related stories; the others one line each.
 */
function StoryIndex({
  id,
  publication,
  n,
  onPick,
  onOpen,
  onClose,
}: {
  id: string;
  /** The issue's newsletter, left out of "Also in". */
  publication?: string;
  n?: number;
  onPick: (n: number) => void;
  onOpen: (id: string) => void;
  onClose?: () => void;
}) {
  const stories = useStories(id);
  const related = useRelated(id);
  const all = stories.data?.stories ?? [];
  const digest = all.length > 1;
  const current = all.find((s) => s.n === n) ?? all[0];

  return (
    <>
      <div class="index-head label">
        <span>In this issue{all.length ? ` · ${all.length}` : ""}</span>
        {onClose ? (
          <button type="button" class="link-btn label" onClick={onClose}>
            Close · Esc
          </button>
        ) : (
          <span>[ / ]</span>
        )}
      </div>
      {stories.status === "loading" && <Skeleton rows={3} />}
      {stories.status === "ok" && all.length === 0 && (
        <div class="index-story open">
          <span class="ybox ink" aria-hidden="true" />
          <p class="index-note">Not split into stories yet.</p>
          <p class="label section-label">Related, before and since</p>
          {related.status === "ok" && (
            <RelatedList
              earlier={related.data.earlier}
              since={related.data.since}
              href={(rid) => queueHref("news", undefined, rid)}
              onOpen={onOpen}
              compact
            />
          )}
        </div>
      )}
      <ol class="index-list">
        {all.map((s) => {
          const open = s.n === current?.n;
          const rel = storyRelated(related.data, s.n, digest);
          const relItems = [...rel.earlier, ...rel.since];
          if (!open) {
            return (
              <li key={s.n} class="index-story">
                <button type="button" class="index-line" onClick={() => onPick(s.n)}>
                  <span class="n">{s.n}</span>
                  <span class="index-h">{s.headline}</span>
                  {relItems.length > 0 && <span class="label count">{relItems.length}</span>}
                </button>
              </li>
            );
          }
          return (
            <li key={s.n} class="index-story open" aria-current="true">
              <span class="ybox ink" aria-hidden="true" />
              <p class="index-open-h">
                <span class="n">{s.n}</span>
                <span>{s.headline}</span>
              </p>
              <p class="index-summary">{s.summary}</p>
              <p class="index-names">
                {namesLine(s, relItems, publication ?? "")}
                {relItems.length > 0 && ` · ${relItems.length} related`}
              </p>
              <div class="key-grid">
                <span class="keycap">O</span>
                {isWebLink(s.link) ? (
                  <a href={s.link} target="_blank" rel="noopener noreferrer">
                    Source ↗
                  </a>
                ) : (
                  <span class="muted">No source link</span>
                )}
                <span />
              </div>
              {related.status === "ok" && (
                <div class="index-related">
                  <p class="label section-label">Related, before and since</p>
                  <RelatedList
                    earlier={rel.earlier}
                    since={rel.since}
                    href={(rid) => queueHref("news", undefined, rid)}
                    onOpen={onOpen}
                    compact
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
