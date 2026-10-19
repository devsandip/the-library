import { useApp } from "../context.js";
import { useLibrary } from "../library.js";
import { useIssueList } from "../list.js";
import { useScrollMemory } from "../nav.js";
import { issueHref, savedHref } from "../paths.js";
import { ContinuePill } from "../components/now-reading.js";
import { Row } from "../components/row.js";
import { Empty, Failed, LoadMore, Skeleton } from "../components/ui.js";

/**
 * Saved (#43): the read-later queue, newest saved first, read or not. Saving takes an issue out
 * of Unread; archiving takes it off Saved. A row taken off stays, faded, until the view changes.
 */
export function Saved() {
  const { api } = useApp();
  const { counts } = useLibrary();
  const list = useIssueList(savedHref(), (cursor) => api.listIssues({ view: "saved", cursor }));
  useScrollMemory(list.status === "ok");
  const total = counts.data?.saved;

  return (
    <section class="saved">
      <header class="screen-head">
        <h1 class="screen-title">Saved</h1>
        <ContinuePill />
      </header>
      <p class="screen-sub label">
        {total === undefined ? "To read later" : `${total} saved`} · newest saved first
      </p>
      {list.status === "loading" && <Skeleton />}
      {list.status === "error" && <Failed message={list.error!} retry={list.reload} />}
      {list.status === "ok" && list.items.length === 0 && (
        <Empty title="Nothing saved.">
          <p class="empty-text">Later on a card, or Save in the reader, keeps an issue here.</p>
        </Empty>
      )}
      <ul class="rows">
        {list.items.map((i) => (
          <Row
            key={i.id}
            issue={i}
            href={issueHref(i.id)}
            savedTag={false}
            onChange={list.patch}
            dim={list.kept.has(i.id) || i.savedAt === undefined}
          />
        ))}
      </ul>
      <LoadMore has={list.hasMore} loading={list.loadingMore} onMore={list.loadMore} />
    </section>
  );
}
