import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { SenderListItem } from "@library/core/types";
import { useApp } from "../context.js";
import { tally } from "../data.js";
import { clock, dateShort } from "../format.js";
import { useLearningList } from "../learning.js";
import { useLibrary } from "../library.js";
import { useIssueList } from "../list.js";
import { useScrollMemory } from "../nav.js";
import {
  browseHref,
  issueHref,
  searchHref,
  slug,
  SHOWS,
  type BrowseFilters,
  type Show,
} from "../paths.js";
import {
  countWord,
  KIND_WORD,
  SHOW_LABEL,
  SHOW_WORD,
  senderIds,
  sendersPhrase,
  senderSlug,
  topicNames,
  topicsPhrase,
} from "../sentence.js";
import { SearchIcon } from "../components/icons.js";
import { ContinuePill } from "../components/now-reading.js";
import { Row } from "../components/row.js";
import { StoryRow } from "../components/story-row.js";
import { Empty, Failed, LoadMore, PullToRefresh, Sheet, Skeleton } from "../components/ui.js";

type Picking = "show" | "topics" | "senders" | undefined;

/**
 * One underlined word of the sentence: a control that reads as part of the sentence. A span
 * with the button role, not a <button>, so a long phrase wraps like the words around it.
 */
export function Word({
  label,
  onPick,
  children,
}: {
  label: string;
  onPick: () => void;
  children: ComponentChildren;
}) {
  return (
    <span
      class="word"
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onPick();
      }}
    >
      {children}
    </span>
  );
}

/**
 * Browse (P2): every unread issue in News, Must Read first with ★, or every unread Learning story
 * (#81), newest first. The sentence on top is the filter bar. On an issue a tap peeks and a double
 * tap opens (#41); a story opens at a tap, in its issue.
 */
export function Browse({ filters }: { filters: BrowseFilters }) {
  const { api } = useApp();
  const lib = useLibrary();
  const { route } = useLocation();
  const [picking, setPicking] = useState<Picking>();

  const topicList = lib.topics.data?.topics ?? [];
  const senderList = lib.senders.data?.items ?? [];
  const names = topicNames(filters.topics, topicList);
  const ids = senderIds(filters.senders, senderList);
  // Slugs resolve once the topics (and, if any are picked, the senders) are in.
  const known =
    lib.topics.status !== "loading" &&
    (!filters.senders.length || lib.senders.status !== "loading");
  const key = browseHref(filters);
  const learning = filters.kind === "learning";
  const never = () => new Promise<never>(() => undefined);
  const issues = useIssueList(known && !learning ? key : "", (cursor) =>
    known && !learning
      ? api.listIssues({ view: filters.show, shelf: "news", topics: names, senders: ids, cursor })
      : never(),
  );
  const stories = useLearningList(known && learning ? key : "", (cursor) =>
    known && learning
      ? api.listLearning({ view: filters.show, topics: names, senders: ids, cursor })
      : never(),
  );
  const list = learning ? stories : issues;
  useScrollMemory(list.status === "ok");

  const f = tally(lib.counts.data, senderList, {
    shelf: filters.kind,
    topics: names,
    senders: ids,
  });
  const set = (next: Partial<BrowseFilters>, replace = false) =>
    route(browseHref({ ...filters, ...next }), replace);
  const count =
    filters.show === "unread"
      ? countWord(f?.total)
      : list.status === "ok"
        ? countWord(list.items.length, list.hasMore)
        : countWord(undefined);
  const senderNames = ids.map((id) => senderList.find((s) => s.senderId === id)?.publication ?? "");
  const lastRun = lib.status.data?.lastRunAt;
  const stale = (i: { state: string; savedAt?: string }) =>
    filters.show === "unread" && (i.state !== "unread" || i.savedAt !== undefined);

  return (
    <section class="browse">
      <PullToRefresh />
      <header class="date-row">
        <span class="label">
          {dateShort()}
          {lastRun && ` · Checked ${clock(lastRun)}`}
        </span>
        <span class="date-tools">
          <ContinuePill />
          <a class="icon-btn" href={searchHref()} aria-label="Search everything">
            <SearchIcon />
          </a>
        </span>
      </header>

      <h1 class="sentence">
        <span class="ink">{count}</span>{" "}
        <Word label={`Show: ${SHOW_LABEL[filters.show]}. Change`} onPick={() => setPicking("show")}>
          {SHOW_WORD[filters.show]}
        </Word>{" "}
        in{" "}
        <Word
          label={`${KIND_WORD[filters.kind]}. Switch to ${filters.kind === "news" ? "Learning" : "News"}`}
          // Switching clears the topics (they belong to a kind) and keeps the senders (BRW-09).
          onPick={() => set({ kind: filters.kind === "news" ? "learning" : "news", topics: [] })}
        >
          {KIND_WORD[filters.kind]}
        </Word>
        ,{" "}
        <Word label={`Topics: ${topicsPhrase(names)}. Change`} onPick={() => setPicking("topics")}>
          {topicsPhrase(names)}
        </Word>
        ,{" "}
        <Word
          label={`Senders: ${sendersPhrase(senderNames)}. Change`}
          onPick={() => setPicking("senders")}
        >
          {sendersPhrase(senderNames)}
        </Word>
        .
      </h1>

      {list.status === "loading" && <Skeleton />}
      {list.status === "error" && <Failed message={list.error!} retry={list.reload} />}
      {list.status === "ok" && list.items.length === 0 && (
        <Empty>
          {filters.topics.length || filters.senders.length ? (
            <button type="button" class="btn line" onClick={() => set({ topics: [], senders: [] })}>
              Clear topics and senders
            </button>
          ) : (
            <p class="empty-text">
              {filters.show === "unread"
                ? `Nothing unread in ${KIND_WORD[filters.kind]}. New ${learning ? "stories" : "issues"} arrive every two hours.`
                : "Nothing here."}
            </p>
          )}
        </Empty>
      )}
      <ul class="rows">
        {learning
          ? stories.items.map((r) => (
              <StoryRow
                key={r.id}
                row={r}
                href={issueHref(r.issue.id, r.story.n)}
                dim={
                  stories.kept.has(r.id) ||
                  (filters.show === "unread" && r.story.state !== undefined)
                }
              />
            ))
          : issues.items.map((i) => (
              <Row
                key={i.id}
                issue={i}
                href={issueHref(i.id)}
                onChange={issues.patch}
                dim={issues.kept.has(i.id) || stale(i)}
              />
            ))}
      </ul>
      <LoadMore has={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} />

      <ShowSheet
        open={picking === "show"}
        show={filters.show}
        onPick={(show) => set({ show }, true)}
        onClose={() => setPicking(undefined)}
      />
      <Sheet
        open={picking === "topics"}
        title="Topics"
        onClose={() => setPicking(undefined)}
        onClear={() => set({ topics: [] }, true)}
      >
        <p class="sheet-sub label">
          Pick any · counts are unread {KIND_WORD[filters.kind].toLowerCase()}
        </p>
        <div class="chips">
          {topicList.map((t) => {
            const on = names.includes(t.name);
            const n = f?.topics.get(t.name) ?? 0;
            if (!on && f && n === 0) return null;
            return (
              <button
                key={t.name}
                type="button"
                class={`chip${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => {
                  const next = on
                    ? filters.topics.filter((s) => s !== slug(t.name))
                    : [
                        ...filters.topics.filter((s) => names.some((x) => slug(x) === s)),
                        slug(t.name),
                      ];
                  set({ topics: next }, true);
                }}
              >
                {t.name}
                <span class="n">{n}</span>
              </button>
            );
          })}
        </div>
      </Sheet>
      <SendersSheet
        open={picking === "senders"}
        senders={senderList}
        counts={f?.senders}
        picked={ids}
        onChange={(next) =>
          set(
            {
              senders: next.map((id) => {
                const s = senderList.find((x) => x.senderId === id);
                return s ? senderSlug(s) : id;
              }),
            },
            true,
          )
        }
        onClose={() => setPicking(undefined)}
      />
    </section>
  );
}

function ShowSheet({
  open,
  show,
  onPick,
  onClose,
}: {
  open: boolean;
  show: Show;
  onPick: (s: Show) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title="Show" onClose={onClose}>
      <div class="options" role="radiogroup" aria-label="Show">
        {SHOWS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === show}
            class={`option${s === show ? " on" : ""}`}
            onClick={() => onPick(s)}
          >
            <span>{SHOW_LABEL[s]}</span>
            <span class="label">
              {s === "unread" ? "Not read yet" : s === "all" ? "Read and unread" : "Done with"}
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * The senders sheet: a search field, Must Read first with ★, each with its unread count and a
 * checkbox. Picking applies at once.
 */
function SendersSheet({
  open,
  senders,
  counts,
  picked,
  onChange,
  onClose,
}: {
  open: boolean;
  senders: SenderListItem[];
  counts?: Map<string, number>;
  picked: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const shown = senders.filter(
    (s) => !q.trim() || s.publication.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const ordered = [...shown.filter((s) => s.mustRead), ...shown.filter((s) => !s.mustRead)];
  const toggle = (id: string) =>
    onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <Sheet open={open} title="Senders" onClose={onClose} onClear={() => onChange([])} tall>
      <label class="field">
        <SearchIcon size={18} />
        <input
          type="search"
          placeholder="Find a newsletter"
          aria-label="Find a newsletter"
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
      </label>
      <ul class="pick-list">
        {ordered.map((s) => (
          <li key={s.senderId}>
            <label class="pick">
              <input
                type="checkbox"
                checked={picked.includes(s.senderId)}
                onChange={() => toggle(s.senderId)}
              />
              <span class="pick-name">
                {s.mustRead && <span class="box-text">★ </span>}
                {s.publication}
                {s.muted && <span class="label"> · muted</span>}
              </span>
              <span class="pick-n label">{counts?.get(s.senderId) ?? 0}</span>
            </label>
          </li>
        ))}
        {ordered.length === 0 && <li class="pick-none">No newsletter matches "{q.trim()}".</li>}
      </ul>
    </Sheet>
  );
}
