import { useEffect, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { IssueListItem } from "@library/core/types";
import type { IssueChange } from "../actions.js";
import { useApp } from "../context.js";
import { patchIssue, tally } from "../data.js";
import { age, reasonCode } from "../format.js";
import { useAsync } from "../hooks.js";
import { useLibrary, useOnRefresh } from "../library.js";
import { useIssueList } from "../list.js";
import { queueHref, slug, type QueueFilters, type QueueTab, type Show } from "../paths.js";
import {
  KIND_WORD,
  SHOW_LABEL,
  SHOW_WORD,
  senderIds,
  sendersPhrase,
  senderSlug,
  topicNames,
  topicsPhrase,
} from "../sentence.js";
import { Word } from "../phone/browse.js";
import { FiveStats } from "../phone/today.js";
import { ThumbIcon } from "../components/icons.js";
import { Peek, usePeekRead } from "../components/peek.js";
import { Empty, Failed, LoadMore, Skeleton } from "../components/ui.js";

export interface QueueItem {
  issue: IssueListItem;
  rank: number;
  five: boolean;
}

/**
 * The console's queue. News, unread, best first, unfiltered is the ranked Summary (the five, then
 * the rest of the 20), followed by any other unread News, newest first. Anything else is the
 * plain list for that tab and filter line.
 */
export function useQueue(tab: QueueTab, f: QueueFilters) {
  const { api } = useApp();
  const lib = useLibrary();
  const topicList = lib.topics.data?.topics ?? [];
  const senderList = lib.senders.data?.items ?? [];
  const names = topicNames(f.topics, topicList);
  const ids = senderIds(f.senders, senderList);
  const ranked =
    tab === "news" &&
    f.show === "unread" &&
    f.order === "best" &&
    !f.topics.length &&
    !f.senders.length;
  const known =
    lib.topics.status !== "loading" && (!f.senders.length || lib.senders.status !== "loading");

  const summary = useAsync(
    () => (ranked ? api.summary() : Promise.resolve(undefined)),
    [ranked],
    ranked ? "summary" : undefined,
  );
  useOnRefresh(summary.reload);
  const key = known ? queueHref(tab, f) : "";
  const list = useIssueList(key, (cursor) =>
    known
      ? api.listIssues({
          view: tab === "saved" ? "saved" : f.show,
          ...(tab === "saved" ? {} : { shelf: tab }),
          topics: names,
          senders: ids,
          cursor,
        })
      : new Promise<never>(() => undefined),
  );

  const top = (ranked && summary.data?.items) || [];
  const digest = new Set(ranked ? (summary.data?.digest ?? []) : []);
  const inTop = new Set(top.map((i) => i.id));
  const rest = list.items.filter((i) => !inTop.has(i.id));
  const items: QueueItem[] = [...top, ...rest].map((issue, k) => ({
    issue,
    rank: k + 1,
    five: digest.has(issue.id),
  }));

  const patch = (id: string, change: IssueChange) => {
    list.patch(id, change);
    if (ranked) summary.set((d) => (d ? { ...d, items: patchIssue(d.items, id, change) } : d));
  };

  const counts = tally(lib.counts.data, senderList, {
    shelf: tab === "saved" ? undefined : tab,
    topics: names,
    senders: ids,
  });
  const status =
    ranked && summary.status !== "ok"
      ? summary.status
      : list.status === "ok" || top.length
        ? "ok"
        : list.status;

  return {
    items,
    ranked,
    summary: summary.data,
    status,
    error: summary.error ?? list.error,
    reload: () => {
      summary.reload();
      list.reload();
    },
    kept: list.kept,
    patch,
    hasMore: list.hasMore,
    loadingMore: list.loadingMore,
    loadMore: list.loadMore,
    count:
      tab === "saved" ? lib.counts.data?.saved : f.show === "unread" ? counts?.total : undefined,
    names,
    ids,
  };
}

type Menu = "show" | "order" | "topics" | undefined;

/** A small menu under a word of the filter line. */
function Popover({
  onClose,
  children,
}: {
  onClose: () => void;
  children: preact.ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => document.addEventListener("click", away));
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", away);
      document.removeEventListener("keydown", esc);
    };
  }, []);
  return (
    <div class="popover" ref={ref} role="dialog">
      {children}
    </div>
  );
}

/**
 * The queue pane (M1): the filter line in the sentence's short form, the five inside one yellow
 * frame, then the rest. The selected issue wears the ink box.
 */
export function QueuePane({
  tab,
  filters,
  queue,
  selected,
  peek,
  onPeek,
}: {
  tab: QueueTab;
  filters: QueueFilters;
  queue: ReturnType<typeof useQueue>;
  selected?: string;
  peek?: string;
  onPeek: (id: string | undefined) => void;
}) {
  const { route } = useLocation();
  const lib = useLibrary();
  const [menu, setMenu] = useState<Menu>();
  const set = (next: Partial<QueueFilters>) => route(queueHref(tab, { ...filters, ...next }));
  const open = (id: string) => route(queueHref(tab, filters, id), true);
  const topicList = lib.topics.data?.topics ?? [];
  const senderList = lib.senders.data?.items ?? [];
  const senderNames = queue.ids.map(
    (id) => senderList.find((s) => s.senderId === id)?.publication ?? "",
  );
  const five = queue.items.filter((q) => q.five);
  const rest = queue.items.filter((q) => !q.five);
  const count =
    queue.count !== undefined
      ? String(queue.count)
      : `${queue.items.length}${queue.hasMore ? "+" : ""}`;

  // The selected row stays in view as J and K move through the queue.
  useEffect(() => {
    if (!selected) return;
    document
      .querySelector(`[data-queue-id="${CSS.escape(selected)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const row = (q: QueueItem) => (
    <QueueRow
      key={q.issue.id}
      q={q}
      selected={q.issue.id === selected}
      peeking={q.issue.id === peek}
      dim={
        queue.kept.has(q.issue.id) ||
        (filters.show === "unread" && tab !== "saved" && q.issue.state !== "unread")
      }
      code={queue.ranked ? reasonCode(q.issue.scoreReason, q.issue.topic) : (q.issue.topic ?? "")}
      onOpen={() => open(q.issue.id)}
      onPeekClose={() => onPeek(undefined)}
      onChange={queue.patch}
    />
  );

  return (
    <section class="queue" aria-label="Queue">
      <p class="queue-line">
        <span class="ink">{count}</span>{" "}
        {tab === "saved" ? (
          <>saved, newest saved first</>
        ) : (
          <>
            <Word
              label={`Show: ${SHOW_LABEL[filters.show]}. Change`}
              onPick={() => setMenu("show")}
            >
              {SHOW_WORD[filters.show]}
            </Word>{" "}
            in {KIND_WORD[tab === "learning" ? "learning" : "news"]},{" "}
            {tab === "news" && filters.show === "unread" ? (
              <Word label="Order. Change" onPick={() => setMenu("order")}>
                {filters.order === "best" ? "best first" : "newest first"}
              </Word>
            ) : (
              "newest first"
            )}
            ,{" "}
            <Word
              label={`Topics: ${topicsPhrase(queue.names)}. Change`}
              onPick={() => setMenu("topics")}
            >
              {topicsPhrase(queue.names)}
            </Word>
            {queue.ids.length > 0 && (
              <>
                ,{" "}
                <Word
                  label={`Senders: ${sendersPhrase(senderNames)}. Clear`}
                  onPick={() => set({ senders: [] })}
                >
                  {sendersPhrase(senderNames)}
                </Word>
              </>
            )}
          </>
        )}
      </p>
      {menu === "show" && (
        <Popover onClose={() => setMenu(undefined)}>
          {(["unread", "all", "archived"] as Show[]).map((s) => (
            <button
              key={s}
              type="button"
              class={`menu-item${s === filters.show ? " on" : ""}`}
              onClick={() => {
                setMenu(undefined);
                set({ show: s });
              }}
            >
              {SHOW_LABEL[s]}
            </button>
          ))}
        </Popover>
      )}
      {menu === "order" && (
        <Popover onClose={() => setMenu(undefined)}>
          {(["best", "newest"] as const).map((o) => (
            <button
              key={o}
              type="button"
              class={`menu-item${o === filters.order ? " on" : ""}`}
              onClick={() => {
                setMenu(undefined);
                set({ order: o });
              }}
            >
              {o === "best" ? "Best first" : "Newest first"}
            </button>
          ))}
        </Popover>
      )}
      {menu === "topics" && (
        <Popover onClose={() => setMenu(undefined)}>
          <p class="label menu-label">Topics</p>
          <div class="chips small">
            {topicList.map((t) => {
              const on = queue.names.includes(t.name);
              return (
                <button
                  key={t.name}
                  type="button"
                  class={`chip${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() =>
                    set({
                      topics: on
                        ? filters.topics.filter((s) => s !== slug(t.name))
                        : [...filters.topics, slug(t.name)],
                    })
                  }
                >
                  {t.name}
                </button>
              );
            })}
          </div>
          <p class="label menu-label">Senders</p>
          <ul class="menu-senders">
            {[
              ...senderList.filter((s) => s.mustRead),
              ...senderList.filter((s) => !s.mustRead),
            ].map((s) => {
              const on = queue.ids.includes(s.senderId);
              return (
                <li key={s.senderId}>
                  <label class="pick">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        set({
                          senders: on
                            ? filters.senders.filter((k) => k !== senderSlug(s) && k !== s.senderId)
                            : [...filters.senders, senderSlug(s)],
                        })
                      }
                    />
                    <span class="pick-name">
                      {s.mustRead && "★ "}
                      {s.publication}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            class="btn line sm"
            onClick={() => {
              setMenu(undefined);
              set({ topics: [], senders: [] });
            }}
          >
            Clear
          </button>
        </Popover>
      )}

      {queue.status === "loading" && <Skeleton rows={6} />}
      {queue.status === "error" && (
        <Failed message={queue.error ?? "Failed"} retry={queue.reload} />
      )}
      {queue.status === "ok" && queue.items.length === 0 && (
        <Empty>
          <p class="empty-text">
            {tab === "saved"
              ? "Nothing saved."
              : "Nothing here. New issues arrive every two hours."}
          </p>
        </Empty>
      )}
      {five.length > 0 && (
        <div class="five-frame mac">
          <span class="ybox" aria-hidden="true" />
          <p class="five-head label">
            <span class="box-text">Today's five</span>
            {queue.summary && <FiveStats summary={queue.summary} />}
          </p>
          <ol class="queue-rows">{five.map(row)}</ol>
        </div>
      )}
      <ol class="queue-rows">{rest.map(row)}</ol>
      <LoadMore has={queue.hasMore} loading={queue.loadingMore} onMore={queue.loadMore} />
    </section>
  );
}

function QueueRow({
  q,
  selected,
  peeking,
  dim,
  code,
  onOpen,
  onPeekClose,
  onChange,
}: {
  q: QueueItem;
  selected: boolean;
  peeking: boolean;
  dim: boolean;
  code: string;
  onOpen: () => void;
  onPeekClose: () => void;
  onChange: (id: string, change: Partial<IssueListItem>) => void;
}) {
  const i = q.issue;
  usePeekRead(i, peeking, onChange);
  return (
    <li
      class={`qrow${selected ? " selected" : ""}${dim ? " dim" : ""}${q.five ? " five" : ""}`}
      data-queue-id={i.id}
    >
      {selected && <span class="ybox ink" aria-hidden="true" />}
      <button
        type="button"
        class="qrow-btn"
        aria-current={selected ? "true" : undefined}
        onClick={onOpen}
      >
        <span class="qrow-rank">{String(q.rank).padStart(2, "0")}</span>
        <span class="qrow-body">
          <span class="qrow-meta label">
            {i.publication}
            {i.mustRead && " ★"} · {i.readMinutes} min · {age(i.receivedAt)}
            {i.rating === 1 && (
              <span class="rel" title="Useful">
                {" · "}
                <ThumbIcon size={11} />
              </span>
            )}
            {i.rating === -1 && (
              <span class="irr" title="Not useful">
                {" · "}
                <ThumbIcon down size={11} />
              </span>
            )}
            {i.savedAt && " · saved"}
          </span>
          <span class="qrow-title">{i.subject}</span>
          {code && <span class="qrow-code label">↳ {code}</span>}
        </span>
      </button>
      {peeking && (
        <Peek
          issue={i}
          id={`peek-${i.id}`}
          onOpen={() => {
            onPeekClose();
            onOpen();
          }}
          wide
        />
      )}
    </li>
  );
}
