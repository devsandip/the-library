import { useEffect, useState } from "preact/hooks";
import type { Follow } from "@library/core/types";
import { useApp } from "../context.js";
import { followingState, markSeen, newPoints, unfollow, useFollowing } from "../following.js";
import { shortDate } from "../format.js";
import { issueHref, queueHref } from "../paths.js";
import { SourceLink, type Links } from "../components/timeline.js";
import { useToast } from "../components/toast.js";
import { Failed } from "../components/ui.js";
import { Page } from "./page.js";

/**
 * Following (#22): the stories Sandip follows, each with its dated points, moving ones first and
 * quiet ones (no movement for 30 days) last. Opening it reads the list again and marks every new
 * point seen; the new ones stay marked for this visit.
 */
export function Following({ wide }: { wide: boolean }) {
  const { api } = useApp();
  const toast = useToast();
  const { state, reload } = useFollowing();
  // What was new when the page opened, by event: still marked after the count clears.
  const [fresh, setFresh] = useState<Map<string, Set<number>>>(new Map());

  useEffect(() => {
    void reload().then(() => {
      const s = followingState();
      if (s.status !== "ok") return;
      setFresh(new Map(s.data.items.map((f) => [f.eventId, newPoints(f)])));
      markSeen(api).catch(() => undefined);
    });
  }, []);

  const links: Links = {
    href: (id, n) => (wide ? queueHref("news", undefined, id, n) : issueHref(id, n)),
  };
  const drop = (f: Follow) =>
    unfollow(api, f).then(
      () => toast.say(`Unfollowed ${f.headline}`),
      (err: Error) => toast.say(err.message),
    );

  const items = state.status === "ok" ? state.data.items : [];
  const moving = items.filter((f) => !f.quiet);
  const quiet = items.filter((f) => f.quiet);
  const newCount = [...fresh.values()].reduce((sum, s) => sum + s.size, 0);
  const sub =
    items.length > 0
      ? `${items.length} ${items.length === 1 ? "story" : "stories"}${newCount ? ` · ${newCount} new` : ""}`
      : undefined;

  return (
    <Page title="Following" wide={wide} sub={sub} class="following">
      {state.status === "loading" && (
        <ol class="deep-skeleton" aria-hidden="true">
          <li />
          <li />
        </ol>
      )}
      {state.status === "error" && <Failed message={state.error} retry={reload} />}
      {state.status === "ok" && !items.length && (
        <p class="search-hint">
          Follow a story from its sheet{wide ? " (F in the story index)" : ""} and it shows here.
          After each delivery, the stories that move it on are added as dated steps; repeats and
          other news are left out.
        </p>
      )}
      {moving.map((f) => (
        <FollowCard
          key={f.eventId}
          f={f}
          fresh={fresh.get(f.eventId)}
          links={links}
          onUnfollow={drop}
        />
      ))}
      {quiet.length > 0 && (
        <>
          <p class="label section-label following-quiet-label">Quiet · no news for 30 days</p>
          {quiet.map((f) => (
            <FollowCard key={f.eventId} f={f} links={links} onUnfollow={drop} quiet />
          ))}
        </>
      )}
    </Page>
  );
}

function FollowCard({
  f,
  fresh,
  links,
  onUnfollow,
  quiet = false,
}: {
  f: Follow;
  fresh?: Set<number>;
  links: Links;
  onUnfollow: (f: Follow) => void;
  quiet?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <article class={`follow-card${quiet ? " quiet" : ""}`}>
      <p class="label follow-meta">
        {f.publication} · followed {shortDate(f.followedAt)}
        {f.movedAt && ` · moved ${shortDate(f.movedAt)}`}
        {fresh?.size ? <span class="follow-new"> · {fresh.size} new</span> : null}
      </p>
      <h2 class="follow-h">
        <a href={links.href(f.issueId, f.n)}>{f.headline}</a>
      </h2>
      <ol class="timeline">
        {f.points.map((p, k) => {
          const isNew = fresh?.has(k) ?? false;
          const pubs = [...new Set(p.sources.map((s) => s.publication))].join(", ");
          return (
            <li key={k} class={isNew ? "new" : undefined}>
              <SourceLink s={p.sources[0]!} links={links}>
                <span class="timeline-when label">
                  {shortDate(p.at)} · {pubs}
                  {isNew && <span class="follow-new"> · New</span>}
                </span>
                <span class="timeline-text">{p.text}</span>
              </SourceLink>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        class="link-btn label"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          Promise.resolve(onUnfollow(f)).finally(() => setBusy(false));
        }}
      >
        Unfollow
      </button>
    </article>
  );
}
