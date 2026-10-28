import { useState } from "preact/hooks";
import { suggest } from "@library/core/audit";
import type { AuditCard, AuditVerdict } from "@library/core/types";
import { useApp } from "../context.js";
import { shortDate } from "../format.js";
import { useLibrary } from "../library.js";
import { issueHref, newsletterHref, queueHref, slug } from "../paths.js";
import { dropCount, setAuditMuted, useAudit } from "../audit.js";
import { useToast } from "../components/toast.js";
import { Failed, Skeleton } from "../components/ui.js";
import { Page } from "./page.js";

/** The page's groups, in its order. */
export const GROUPS: { verdict: AuditVerdict; title: string }[] = [
  { verdict: "drop", title: "Worth dropping" },
  { verdict: "keep", title: "Keep" },
  // Mostly weeklies with a few issues in the window (#152), so not "new".
  { verdict: "new", title: "Too few to tell" },
];

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Why, in numbers: the sentence under a newsletter's name. A Must Read one that would otherwise
 * be worth dropping says so and why, since the star keeps it whatever its numbers (#152).
 */
export function why(c: AuditCard, days: number): string {
  switch (c.reason) {
    case "mustRead": {
      const without = suggest({ ...c, mustRead: false });
      return without.verdict === "drop"
        ? `Must Read: starred to keep, though otherwise worth dropping. ${why({ ...c, ...without }, days)}`
        : "Must Read: starred to keep.";
    }
    case "muted":
      return "Muted, so you never see it.";
    case "few":
      return `${plural(c.issues, "issue")} in ${plural(days, "day")}: too few to tell.`;
    case "notUseful":
      return `Rated not useful ${times(c.notUseful)}${c.useful ? `, useful ${times(c.useful)}` : ""}.`;
    case "unopened":
      return `Opened ${c.opened} of ${c.issues} issues, and never rated useful.`;
    case "repeats":
      return `${c.repeats} of its ${c.stories} stories ran first elsewhere, and never rated useful.`;
    case "useful":
      return `Rated useful ${times(c.useful)}${c.notUseful ? `, not useful ${times(c.notUseful)}` : ""}.`;
    case "opened":
      return `Opened ${c.opened} of ${c.issues} issues.`;
  }
}

/** "12 issues · 2 promos · 6 opened · 2 ✓ · 1 ✕": what it sent and what Sandip did with it. */
export function countsLine(c: AuditCard): string {
  return [
    plural(c.issues, "issue"),
    c.promos && plural(c.promos, "promo"),
    `${c.opened} opened`,
    c.useful && `${c.useful} ✓`,
    c.notUseful && `${c.notUseful} ✕`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "10 stories · 7 ran first elsewhere, 4 in Alpha · 2 only here", or nothing without stories. */
export function storiesLine(c: AuditCard): string | undefined {
  if (!c.stories) return undefined;
  const first =
    c.repeats &&
    `${c.repeats} ran first elsewhere${c.firstBy ? `, ${c.firstBy.stories} in ${c.firstBy.publication}` : ""}`;
  return [plural(c.stories, "story", "stories"), first, c.only && `${c.only} only here`]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Subscription audit (#25, #151): a report card per newsletter over the last 30 days, worth
 * dropping first with why in numbers, its own Unsubscribe link and Mute; then the ones to keep,
 * then the ones with too few issues to tell. Each opens its newsletter's page.
 */
export function Audit({ wide }: { wide: boolean }) {
  const { api } = useApp();
  const { senders } = useLibrary();
  const toast = useToast();
  const { state, reload } = useAudit();
  const href = (id: string, n: number) =>
    wide ? queueHref("news", undefined, id, n) : issueHref(id, n);
  const mute = (c: AuditCard, muted: boolean) =>
    setAuditMuted(api, c.senderId, muted).then(
      () => {
        senders.reload();
        toast.say(muted ? `Muted ${c.publication}` : `Unmuted ${c.publication}`);
      },
      (err: Error) => toast.say(err.message),
    );
  const data = state.status === "ok" ? state.data : undefined;
  const drop = dropCount(state) ?? 0;

  return (
    <Page
      title="Subscription audit"
      wide={wide}
      sub={
        data &&
        `Last ${plural(data.days, "day")} · ${plural(data.cards.length, "newsletter")}${drop ? ` · ${drop} worth dropping` : ""}`
      }
      class="audit"
    >
      {state.status === "loading" && <Skeleton />}
      {state.status === "error" && <Failed message={state.error} retry={reload} />}
      {data && data.days < 30 && (
        <p class="audit-note">
          Counting from {shortDate(data.from)}, when Nutgraf started logging what you open.
        </p>
      )}
      {data && !data.cards.length && (
        <p class="search-hint">
          Each newsletter that sent something in the last 30 days shows here, with what you did with
          it and whether it is worth keeping.
        </p>
      )}
      {data &&
        GROUPS.map(({ verdict, title }) => {
          const cards = data.cards.filter((c) => c.verdict === verdict);
          if (!cards.length) return null;
          return (
            <section key={verdict} class={`audit-group ${verdict}`} aria-label={title}>
              <h2 class="group-label label">
                {title} · {cards.length}
              </h2>
              <ul class="audit-list">
                {cards.map((c) => (
                  <AuditRow key={c.senderId} c={c} days={data.days} href={href} onMute={mute} />
                ))}
              </ul>
            </section>
          );
        })}
    </Page>
  );
}

function AuditRow({
  c,
  days,
  href,
  onMute,
}: {
  c: AuditCard;
  days: number;
  href: (id: string, n: number) => string;
  onMute: (c: AuditCard, muted: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const mute = () => {
    setBusy(true);
    void onMute(c, !c.muted).finally(() => setBusy(false));
  };
  const stories = storiesLine(c);
  return (
    <li class={`audit-card ${c.verdict}`}>
      <a class="audit-name" href={newsletterHref(slug(c.publication))}>
        {c.mustRead && <span aria-label="Must Read">★ </span>}
        {c.publication}
      </a>
      <p class="audit-why">{why(c, days)}</p>
      <p class="label audit-counts">{countsLine(c)}</p>
      {stories && <p class="label audit-counts">{stories}</p>}
      {c.onlyHeadlines.length > 0 && (
        <ul class="audit-only" aria-label="Only here">
          {c.onlyHeadlines.map((h) => (
            <li key={`${h.issueId}#${h.n}`}>
              <a href={href(h.issueId, h.n)}>{h.headline}</a>
            </li>
          ))}
        </ul>
      )}
      {c.verdict === "drop" && (
        <div class="audit-actions">
          {c.unsubscribeUrl && (
            <a
              class="btn line sm"
              href={c.unsubscribeUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Unsubscribe ↗
            </a>
          )}
          <button
            type="button"
            class={`btn line sm${c.muted ? " on" : ""}`}
            aria-pressed={c.muted}
            disabled={busy}
            onClick={mute}
          >
            {c.muted ? "Muted" : "Mute"}
          </button>
        </div>
      )}
    </li>
  );
}
