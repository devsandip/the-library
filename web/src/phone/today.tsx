import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { readerDay } from "@library/core/days";
import type { IssueListItem, Narrative, SummaryResponse } from "@library/core/types";
import { useIssueActions, type IssueChange } from "../actions.js";
import { useApp } from "../context.js";
import { handled, patchIssue, storiesOf, useStories } from "../data.js";
import { age, clock, narrativeLine, reasonLine, skimMinutes } from "../format.js";
import { useAsync } from "../hooks.js";
import { useOnRefresh } from "../library.js";
import { goBack, useScrollMemory } from "../nav.js";
import { browseHref, DEFAULT_BROWSE, issueHref, todayHref } from "../paths.js";
import { ContinuePill } from "../components/now-reading.js";
import { Row } from "../components/row.js";
import { useToast } from "../components/toast.js";
import { Empty, Failed, PullToRefresh, Skeleton } from "../components/ui.js";
import { SwipeCard } from "./deck.js";

/** The brief, folded for the reader's day (SUM-12), remembered in this browser. */
const FOLD_KEY = "library.brief.folded";

function foldedToday(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === readerDay(Date.now());
  } catch {
    return false;
  }
}

function setFolded(on: boolean) {
  try {
    if (on) localStorage.setItem(FOLD_KEY, readerDay(Date.now()));
    else localStorage.removeItem(FOLD_KEY);
  } catch {
    // Blocked storage: the fold lasts until the page reloads.
  }
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const inWords = (n: number) => WORDS[n] ?? String(n);
const two = (n: number) => String(n).padStart(2, "0");

/** The summary as Today shows it: shared by the deck and the list view. */
function useToday() {
  const { api } = useApp();
  const summary = useAsync(() => api.summary(), [], "summary");
  useOnRefresh(summary.reload);
  const patch = (id: string, change: IssueChange) =>
    summary.set((d) => ({ ...d, items: patchIssue(d.items, id, change) }));
  return { summary, patch };
}

function Header({ list }: { list: boolean }) {
  return (
    <header class="screen-head">
      <h1 class="screen-title">Today</h1>
      <ContinuePill long />
      <span class="sr-only">{list ? "List view" : "Cards"}</span>
    </header>
  );
}

/**
 * Today (P1): the day's 20 ranked News issues as a deck, best first. The brief is the first card
 * until it is folded; the day's five carry the yellow box. Right is Relevant (it stays unread and
 * leaves the deck), left is Irrelevant and archived, Later saves it, a tap opens it.
 */
export function Today({ mode }: { mode: "deck" | "list" | "brief" }) {
  if (mode === "brief") return <Brief />;
  if (mode === "list") return <TodayList />;
  return <TodayDeck />;
}

function TodayDeck() {
  const { route } = useLocation();
  const { api } = useApp();
  const { summary, patch } = useToday();
  const actions = useIssueActions({ patch });
  const toast = useToast();
  const [folded, fold] = useState(foldedToday);

  const data = summary.data;
  const items = data?.items ?? [];
  const digest = data?.digest ?? [];
  const brief = data?.narrative && !folded ? data.narrative : undefined;
  const at = items.findIndex((i) => !handled(i));
  const top = at === -1 ? undefined : items[at];
  const left = items.filter((i) => !handled(i));
  const minutes = skimMinutes(left.map((i) => i.summary ?? i.subject));
  // The card after this one, so its stories are in before it comes up.
  const next = left[1];
  if (next) void storiesOf(api, next.id).catch(() => undefined);

  const foldBrief = () => {
    fold(true);
    setFolded(true);
    toast.say("Brief folded for today", {
      label: "Undo",
      run: () => {
        fold(false);
        setFolded(false);
      },
    });
  };

  const progress = (
    <div class="deck-progress">
      <div class="deck-line label">
        <span>
          {brief
            ? `The brief, then ${items.length} cards`
            : top
              ? `Card ${at + 1} of ${items.length} · ~${minutes} min left`
              : `${items.length} of ${items.length} done`}
        </span>
        <a class="deck-switch" href={todayHref("list")}>
          List view
        </a>
      </div>
      <div class="ticks" aria-hidden="true">
        {items.map((i, k) => (
          <span key={i.id} class={brief ? "" : handled(i) ? "done" : k === at ? "now" : ""} />
        ))}
      </div>
    </div>
  );

  let body;
  if (summary.status === "loading") body = <div class="deck-skeleton" aria-busy="true" />;
  else if (summary.status === "error")
    body = <Failed message={summary.error} retry={summary.reload} />;
  else if (brief) {
    body = (
      <Deck behind={Math.min(2, left.length)}>
        <SwipeCard key="brief" labels={{ right: "Fold", left: "Fold" }} onSwipe={foldBrief}>
          <BriefCard
            narrative={brief}
            onFold={foldBrief}
            onRead={() => route(todayHref("brief"))}
          />
        </SwipeCard>
      </Deck>
    );
  } else if (top) {
    const five = digest.indexOf(top.id);
    body = (
      <Deck behind={Math.min(2, left.length - 1)} five={five !== -1}>
        <SwipeCard
          key={top.id}
          labels={{ right: "✓ Relevant", left: "Irrelevant" }}
          onSwipe={(way) => (way === "right" ? actions.relevant(top) : actions.irrelevant(top))}
          onTap={() => route(issueHref(top.id))}
          class={five !== -1 ? "five" : ""}
        >
          <IssueCard
            issue={top}
            label={five !== -1 ? `${two(five + 1)} of today's five` : `${two(at + 1)} · Best first`}
            five={five !== -1}
            onLater={() => actions.save(top)}
            onOpen={() => route(issueHref(top.id))}
            onRelevant={() => actions.relevant(top)}
            onIrrelevant={() => actions.irrelevant(top)}
          />
        </SwipeCard>
      </Deck>
    );
  } else {
    body = (
      <Empty>
        <p class="empty-text">You are through today's picks. Browse holds the rest.</p>
        <a class="btn fill" href={browseHref(DEFAULT_BROWSE)}>
          Open Browse
        </a>
      </Empty>
    );
  }

  return (
    <section class="today">
      <PullToRefresh />
      <Header list={false} />
      {summary.status === "ok" && items.length > 0 && progress}
      {body}
      {top && !brief && (
        <div class="deck-hints label" aria-hidden="true">
          <span class="irr">← Irrelevant</span>
          <span>Tap to open</span>
          <span class="rel">Relevant →</span>
        </div>
      )}
    </section>
  );
}

/** The stack: the top card, with up to two cards' edges behind it. */
function Deck({
  behind,
  five = false,
  children,
}: {
  behind: number;
  five?: boolean;
  children: preact.ComponentChildren;
}) {
  return (
    <div class={`deck${five ? " with-five" : ""}`}>
      {behind >= 2 && <div class="card back two" aria-hidden="true" />}
      {behind >= 1 && <div class="card back one" aria-hidden="true" />}
      {children}
    </div>
  );
}

function IssueCard({
  issue: i,
  label,
  five,
  onLater,
  onOpen,
  onRelevant,
  onIrrelevant,
}: {
  issue: IssueListItem;
  label: string;
  five: boolean;
  onLater: () => void;
  onOpen: () => void;
  /** The swipes, as buttons for VoiceOver. */
  onRelevant: () => void;
  onIrrelevant: () => void;
}) {
  const stories = useStories(i.id).data?.stories ?? [];
  const digest = stories.length > 1;
  return (
    <>
      {five && <span class="ybox card-box" aria-hidden="true" />}
      <p class={`card-label label${five ? " box-text" : ""}`}>{label}</p>
      <p class="card-meta label">
        {i.mustRead && "★ "}
        {i.publication} · {age(i.receivedAt)} · {i.readMinutes} min
        {digest && ` · ${stories.length} stories`}
      </p>
      <h2 class="card-title">{i.subject}</h2>
      {i.summary && <p class="card-line">{i.summary}</p>}
      {digest && (
        <div class="card-inside">
          <p class="label">Inside</p>
          {stories.slice(0, 2).map((s) => (
            <p class="card-story" key={s.n}>
              <span class="n">{s.n}</span>
              <span>{s.headline}</span>
            </p>
          ))}
          {stories.length > 2 && <p class="card-more label">+ {stories.length - 2} more</p>}
        </div>
      )}
      <div class="card-foot">
        {i.scoreReason && (
          <p class="card-why">
            <span class="label">Why </span>
            {reasonLine(i.scoreReason, i.publication)}
          </p>
        )}
        <div class="card-buttons">
          <button type="button" class="btn line" onClick={onLater}>
            Later
          </button>
          <button type="button" class="btn fill" onClick={onOpen}>
            Open
          </button>
        </div>
        <span class="sr-only">
          <button type="button" onClick={onRelevant}>
            Relevant
          </button>
          <button type="button" onClick={onIrrelevant}>
            Irrelevant and archive
          </button>
        </span>
      </div>
    </>
  );
}

function BriefCard({
  narrative: n,
  onFold,
  onRead,
}: {
  narrative: Narrative;
  onFold: () => void;
  onRead: () => void;
}) {
  return (
    <>
      <p class="card-label label box-text">
        In brief · {n.threads.length} threads · {clock(n.at)}
      </p>
      <h2 class="card-title">The day, before you start</h2>
      <p class="card-line">
        {n.stories} stories from {n.newsletters} newsletters, written up as{" "}
        {inWords(n.threads.length)} {n.threads.length === 1 ? "thread" : "threads"}.
      </p>
      <ol class="brief-threads">
        {n.threads.map((t) => (
          <li key={t.title}>
            <span class="brief-thread">{t.title}</span>
            <span class="label">
              {[...new Set(t.sources.map((s) => s.publication))].join(" · ")}
            </span>
          </li>
        ))}
      </ol>
      <div class="card-foot">
        <div class="card-buttons">
          <button type="button" class="btn line" onClick={onFold}>
            Fold
          </button>
          <button type="button" class="btn fill" onClick={onRead}>
            Read the brief
          </button>
        </div>
      </div>
    </>
  );
}

/** "List view": the same 20 as a ranked list, the five inside one yellow frame. */
function TodayList() {
  const { summary, patch } = useToday();
  const actions = useIssueActions({ patch });
  useScrollMemory(summary.status === "ok");
  const items = summary.data?.items ?? [];
  const digest = new Set(summary.data?.digest ?? []);
  const five = items.filter((i) => digest.has(i.id));
  const rest = items.filter((i) => !digest.has(i.id));
  const row = (i: IssueListItem) => (
    <Row
      key={i.id}
      issue={i}
      href={issueHref(i.id)}
      actions={actions}
      onChange={patch}
      rank={items.indexOf(i) + 1}
      five={digest.has(i.id)}
      dim={handled(i)}
    />
  );
  return (
    <section class="today">
      <PullToRefresh />
      <Header list />
      <div class="deck-line label list-line">
        <span>{items.length ? `${items.length} best first` : ""}</span>
        <a class="deck-switch" href={todayHref()}>
          Card view
        </a>
      </div>
      {summary.status === "loading" && <Skeleton />}
      {summary.status === "error" && <Failed message={summary.error} retry={summary.reload} />}
      {summary.status === "ok" && items.length === 0 && (
        <Empty>
          <p class="empty-text">No unread News right now. New issues arrive every two hours.</p>
        </Empty>
      )}
      {five.length > 0 && (
        <div class="five-frame">
          <span class="ybox" aria-hidden="true" />
          <p class="five-head label">
            <span class="box-text">Today's five</span>
            <FiveStats summary={summary.data!} />
          </p>
          <ul class="rows">{five.map(row)}</ul>
        </div>
      )}
      {rest.length > 0 && <ul class="rows">{rest.map(row)}</ul>}
    </section>
  );
}

/** "Fixed 07:52 · 64% hit / 14d": when the five were fixed, and how they have fared (#5). */
export function FiveStats({ summary }: { summary: SummaryResponse }) {
  const s = summary.digestStats;
  const hit = s && s.shown > 0 ? Math.round((100 * s.relevant) / s.shown) : undefined;
  const parts = [
    summary.digestAt ? `Fixed ${clock(summary.digestAt)}` : undefined,
    hit !== undefined ? `${hit}% hit / 14d` : undefined,
  ].filter(Boolean);
  return <span>{parts.join(" · ")}</span>;
}

/** "Read the brief": the day's news as a few threads (#18), each naming its newsletters. */
function Brief() {
  const { route } = useLocation();
  const { summary } = useToday();
  const n = summary.data?.narrative;
  return (
    <section class="brief-page">
      <div class="top-bar">
        <button type="button" class="back" onClick={() => goBack(route, todayHref())}>
          ‹ Today
        </button>
      </div>
      <h1 class="page-title">The day in brief</h1>
      {summary.status === "loading" && <Skeleton rows={3} />}
      {summary.status === "ok" && !n && (
        <Empty title="No brief yet.">
          <p class="empty-text">It is written once the day's first News arrives.</p>
        </Empty>
      )}
      {n && (
        <>
          <p class="page-sub label">{narrativeLine(n)}</p>
          {n.threads.map((t) => (
            <article class="thread" key={t.title}>
              <h2>{t.title}</h2>
              <p>{t.text}</p>
              <p class="thread-sources label">
                {t.sources.map((s, k) => (
                  <span key={s.issueId}>
                    {k > 0 && " · "}
                    <a href={issueHref(s.issueId)}>{s.publication}</a>
                  </span>
                ))}
              </p>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
