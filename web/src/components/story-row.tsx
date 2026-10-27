import type { LearningRow } from "../learning.js";
import { age } from "../format.js";

/**
 * One Learning story in a list (#81): its newsletter (with ★ for Must Read) and age, the story's
 * headline and what it says, and its own state as tags. A tap opens the story in its issue.
 */
export function StoryRow({
  row,
  href,
  dim = false,
}: {
  row: LearningRow;
  href: string;
  dim?: boolean;
}) {
  const { issue: i, story: s } = row;
  const tags = [
    s.state === "read" ? "Read" : undefined,
    s.state === "archived" ? "Archived" : undefined,
  ].filter(Boolean);
  return (
    <li class={`row-item story-row${dim ? " dim" : ""}`}>
      <div class="row-face">
        <a class="row" href={href}>
          <span class="row-meta label">
            <span class={`row-pub${i.mustRead ? " must" : ""}`}>
              {i.mustRead && <span aria-label="Must Read">★ </span>}
              {i.publication}
            </span>
            <span class="row-when">{age(i.receivedAt)}</span>
          </span>
          <span class="row-title">{s.headline}</span>
          <span class="row-line">{s.summary}</span>
          {tags.length > 0 && (
            <span class="row-tags label">
              {i.topic && `${i.topic} · `}
              {tags.join(" · ")}
            </span>
          )}
        </a>
      </div>
    </li>
  );
}
