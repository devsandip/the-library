import type { RelatedItem } from "@library/core/types";
import { useApp } from "../context.js";
import { issueHref } from "../filters.js";
import { relativeTime } from "../format.js";
import { useAsync } from "../hooks.js";
import { clickInPlace } from "../nav.js";

/**
 * Related issues under the newsletter (#20): the closest ones from before and since, found on
 * the embeddings enrichment stores. When nothing is close, nothing shows.
 */
export function Related({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  const { api } = useApp();
  const related = useAsync(() => api.related(id), [id]);
  if (related.status !== "ok") return null;
  const { earlier, since } = related.data;
  if (!earlier.length && !since.length) return null;

  const side = (title: string, items: RelatedItem[]) =>
    items.length > 0 && (
      <>
        <h3>{title}</h3>
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
                  {i.publication} ·{" "}
                  <time dateTime={i.receivedAt}>{relativeTime(i.receivedAt)}</time>
                </span>
                <span class="related-line">{i.summary ?? i.subject}</span>
              </a>
            </li>
          ))}
        </ul>
      </>
    );

  return (
    <section class="related" aria-label="Related issues">
      <h2>Related</h2>
      {side("Earlier", earlier)}
      {side("Since", since)}
    </section>
  );
}
