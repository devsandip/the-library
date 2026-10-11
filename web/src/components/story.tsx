import type { IssueStory, RelatedItem } from "@library/core/types";
import { alsoIn } from "../data.js";
import { shortDate } from "../format.js";
import { clickInPlace } from "../nav.js";

/** "OpenAI · IndiGo · Marriott · Also in Platformer, The Ken": who a story is about, and where else it ran. */
export function namesLine(story: IssueStory, related: RelatedItem[], self: string): string {
  const also = alsoIn(related, self);
  return [
    ...(story.names ?? []).slice(0, 4),
    ...(also.length
      ? [`Also in ${also.slice(0, 2).join(", ")}${also.length > 2 ? " and more" : ""}`]
      : []),
  ].join(" · ");
}

/**
 * A story's related stories (#20), earlier and since: the date, the headline, the newsletter.
 * A click opens that issue (in the console, on the Mac, through `onOpen`).
 */
export function RelatedList({
  earlier,
  since,
  href,
  onOpen,
  compact = false,
}: {
  earlier: RelatedItem[];
  since: RelatedItem[];
  href: (id: string) => string;
  onOpen?: (id: string) => void;
  compact?: boolean;
}) {
  const all = [...earlier, ...since].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  if (!all.length) return <p class="related-none">Nothing close yet, from before or since.</p>;
  return (
    <ol class={`timeline${compact ? " compact" : ""}`}>
      {all.map((i) => (
        <li key={`${i.id}#${i.story?.n ?? 0}`}>
          <a
            href={href(i.id)}
            onClick={(e) => {
              if (onOpen) clickInPlace(e, () => onOpen(i.id));
            }}
          >
            <span class="timeline-when label">
              {shortDate(i.receivedAt)}
              {!compact && ` · ${i.publication}`}
            </span>
            <span class="timeline-text">
              {i.story?.headline ?? i.summary ?? i.subject}
              {compact && <span class="timeline-pub"> · {i.publication}</span>}
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}
