import type { RelatedItem } from "@library/core/types";
import { useApp } from "../context.js";
import { issueHref } from "../filters.js";
import { relativeTime } from "../format.js";
import { useAsync } from "../hooks.js";
import { clickInPlace } from "../nav.js";

/**
 * Related stories under the newsletter (#20): the closest stories from other issues, before and
 * since. A digest has them for each of its stories, under the story's headline; an issue with one
 * story has them for the whole issue. When nothing is close, nothing shows.
 */
export function Related({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  const { api } = useApp();
  const related = useAsync(() => api.related(id), [id]);
  if (related.status !== "ok") return null;
  const { earlier, since, stories = [] } = related.data;
  if (!earlier.length && !since.length && !stories.length) return null;

  const list = (items: RelatedItem[]) => (
    <ul class="related-list">
      {items.map((i) => (
        <li key={i.id}>
          <a
            href={issueHref(i.id)}
            onClick={(e) => {
              if (onOpen) clickInPlace(e, () => onOpen(i.id));
            }}
          >
            <span class="related-pub">
              {i.publication} · <time dateTime={i.receivedAt}>{relativeTime(i.receivedAt)}</time>
            </span>
            <span class="related-line">{i.story?.headline ?? i.summary ?? i.subject}</span>
          </a>
        </li>
      ))}
    </ul>
  );
  // Reading the latest issue, everything is from before: headings only once something came since.
  const sides = (e: RelatedItem[], s: RelatedItem[], Heading: "h3" | "h4") =>
    s.length === 0 ? (
      list(e)
    ) : (
      <>
        {e.length > 0 && (
          <>
            <Heading class="related-side">Earlier</Heading>
            {list(e)}
          </>
        )}
        <Heading class="related-side">Since</Heading>
        {list(s)}
      </>
    );

  return (
    <section class="related" aria-label="Related stories">
      <h2>Related</h2>
      {(earlier.length > 0 || since.length > 0) && sides(earlier, since, "h3")}
      {stories.map((s) => (
        <div class="related-story" key={s.n}>
          <h3>{s.headline}</h3>
          {sides(s.earlier, s.since, "h4")}
        </div>
      ))}
    </section>
  );
}
