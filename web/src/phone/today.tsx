import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { readerDay } from "@library/core/days";
import type { IssueListItem, Narrative, SummaryResponse } from "@library/core/types";
import { useIssueActions, type IssueActions, type IssueChange } from "../actions.js";
import { useApp } from "../context.js";
import { handled, patchIssue, storiesOf, useStories } from "../data.js";
import { age, clock, narrativeLine, reasonLine, skimMinutes } from "../format.js";
import { useAsync } from "../hooks.js";
import { deckStep, type SwipeWay } from "../gesture.js";
import { useOnRefresh } from "../library.js";
import { goBack, useScrollMemory } from "../nav.js";
import { browseHref, DEFAULT_BROWSE, issueHref, todayHref } from "../paths.js";
import { ContinuePill } from "../components/now-reading.js";
import { Row } from "../components/row.js";
import { Thumbs } from "../components/thumbs.js";
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
 * until it is folded; the day's five carry the yellow box. Swipes only move through the deck: left
 * is the next card, right the one before (from the first card, back to the brief). The thumbs say
 * whether an issue was useful, Later saves it and moves on, a tap opens it.
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
  // The card on top. Until there is one, the first not dealt with yet, then it stays put: a
  // thumb or Later on it does not move the deck.
  const [current, setCurrent] = useState<string>();

  const data = summary.data;
  const items = data?.items ?? [];
  const digest = data?.digest ?? [];
  const brief = data?.narrative && !folded ? data.narrative : undefined;
  const pinned = items.findIndex((i) => i.id === current);
  const at =
    pinned !== -1
      ? pinned
      : Math.max(
          0,
          items.findIndex((i) => !handled(i)),
        );
  const top = items[at];
  useEffect(() => {
    if (top && top.id !== current) setCurrent(top.id);
  }, [top?.id]);
  const minutes = skimMinutes(items.slice(at).map((i) => i.summary ?? i.subject));
  // The cards either side, so their stories are in before they come up.
  for (const near of [items[at + 1], items[at - 1]]) {
    if (near) void storiesOf(api, near.id).catch(() => undefined);
  }

  const setBrief = (on: boolean) => {
    fold(!on);
    setFolded(!on);
  };
  const foldBrief = () => {
    setBrief(false);
    toast.say("Brief folded for today", { label: "Undo", run: () => setBrief(true) });
  };
  // Past the brief is the card the deck was on; back from the first card is the brief again.
  const step = (way: SwipeWay) => deckStep(at, way, items.length, Boolean(data?.narrative));
  const swipe = (way: SwipeWay) => {
    if (brief) {
      if (way === "left") setBrief(false);
      return;
    }
    const to = step(way);
    if (to === -1) setBrief(true);
    else if (to !== undefined) setCurrent(items[to]!.id);
  };
  const labels = brief
    ? { left: "Next" }
    : {
        left: step("left") !== undefined ? "Next" : undefined,
        right: step("right") === -1 ? "Brief" : step("right") !== undefined ? "Back" : undefined,
      };

  const progress = (
    <div class="deck-progress">
      <div class="deck-line label">
        <span>
          {brief
            ? `The brief, then ${items.length} cards`
            : `Card ${at + 1} of ${items.length} · ~${minutes} min left`}
        </span>
        <a class="deck-switch" href={todayHref("list")}>
          List view
        </a>
      </div>
      <div class="ticks" aria-hidden="true">
        {items.map((i, k) => (
          <span key={i.id} class={brief ? "" : k === at ? "now" : handled(i) ? "done" : ""} />
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
      <Deck behind={Math.min(2, items.length)}>
        <SwipeCard key="brief" labels={labels} onSwipe={swipe}>
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
      <Deck behind={Math.min(2, items.length - at - 1)} five={five !== -1}>
        <SwipeCard
          key={top.id}
          labels={labels}
          onSwipe={swipe}
          onTap={() => route(issueHref(top.id))}
          class={five !== -1 ? "five" : ""}
        >
          <IssueCard
            issue={top}
            label={five !== -1 ? `${two(five + 1)} of today's five` : `${two(at + 1)} · Best first`}
            five={five !== -1}
            actions={actions}
            onLater={() => {
              actions.save(top);
              if (top.savedAt === undefined) swipe("left");
            }}
            onOpen={() => route(issueHref(top.id))}
            onNext={labels.left ? () => swipe("left") : undefined}
            onBack={
              labels.right
                ? {
                    text: labels.right === "Brief" ? "Back to the brief" : "Previous card",
                    run: () => swipe("right"),
                  }
                : undefined
            }
          />
        </SwipeCard>
      </Deck>
    );
  } else {
    body = (
      <Empty>
        <p class="empty-text">No unread News right now. New issues arrive every two hours.</p>
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
      {(top || brief) && (
        <div class="deck-hints label" aria-hidden="true">
          <span>{labels.left ? "← Next" : ""}</span>
          <span>{brief ? "" : "Tap to open"}</span>
          <span>{labels.right ? `${labels.right} →` : ""}</span>
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
  actions,
  onLater,
  onOpen,
  onNext,
  onBack,
}: {
  issue: IssueListItem;
  label: string;
  five: boolean;
  actions: IssueActions;
  onLater: () => void;
  onOpen: () => void;
  /** The swipes, as buttons for VoiceOver; absent at either end of the deck. */
  onNext?: () => void;
  onBack?: { text: string; run: () => void };
}) {
  const stories = useStories(i.id).data?.stories ?? [];
  const digest = stories.length > 1;
  const saved = i.savedAt !== undefined;
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
        <div class="card-buttons thumbs">
          <Thumbs issue={i} actions={actions} class="btn line thumb" />
          <button
            type="button"
            class={`btn line${saved ? " on" : ""}`}
            aria-pressed={saved}
            onClick={onLater}
          >
            {saved ? "Saved" : "Later"}
          </button>
          <button type="button" class="btn fill" onClick={onOpen}>
            Open
          </button>
        </div>
        <span class="sr-only">
          {onBack && (
            <button type="button" onClick={onBack.run}>
              {onBack.text}
            </button>
          )}
          {onNext && (
            <button type="button" onClick={onNext}>
              Next card
            </button>
          )}
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
  const hit = s && s.shown > 0 ? Math.round((100 * s.useful) / s.shown) : undefined;
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
