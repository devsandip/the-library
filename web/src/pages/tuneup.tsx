import { useState } from "preact/hooks";
import type {
  AuditHeadline,
  Shelf,
  TuneupNewsletter,
  TuneupProposal,
  TuneupResponse,
} from "@library/core/types";
import { useApp } from "../context.js";
import { useLibrary } from "../library.js";
import { issueHref, newsletterHref, queueHref, slug } from "../paths.js";
import { applyProposal, dismissProposal, useTuneup } from "../tuneup.js";
import { useToast } from "../components/toast.js";
import { Failed, Skeleton } from "../components/ui.js";
import { Page } from "./page.js";

const SHELF: Record<Shelf, string> = { learning: "Learning", news: "News" };
const otherShelf = (s: Shelf): Shelf => (s === "learning" ? "news" : "learning");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Corrections in all: moves against Jev and promos pulled back. */
export const corrections = (t: TuneupResponse["totals"]) => t.toLearning + t.toNews + t.pulledBack;

/** "Always Learning". */
export const ruleLine = (p: TuneupProposal) => `Always ${SHELF[p.shelf]}`;

/** Why the rule, in numbers: the moves it would have made for Sandip. */
export function whyRule(p: TuneupProposal): string {
  return (
    `You moved ${plural(p.fixes, "story", "stories")} to ${SHELF[p.shelf]} that Jev put on ` +
    `${SHELF[otherShelf(p.shelf)]}, and none the other way.`
  );
}

/** "11 of 12 stories on Learning now · would move 1 more from News", replayed over its stories. */
export function replayLine(p: TuneupProposal): string {
  return [
    `${p.onShelf} of ${plural(p.stories, "story", "stories")} on ${SHELF[p.shelf]} now`,
    p.moves
      ? `would move ${p.moves} more from ${SHELF[otherShelf(p.shelf)]}`
      : "moves nothing else",
  ].join(" · ");
}

/** "4 moved · 2 to Learning, 1 to News against Jev · 2 Jev was unsure of". */
export function movesLine(n: TuneupNewsletter): string | undefined {
  if (!n.moved) return undefined;
  const to = [
    n.toLearning && `${n.toLearning} to Learning`,
    n.toNews && `${n.toNews} to News`,
  ].filter(Boolean);
  return [
    `${n.moved} moved`,
    to.length ? `${to.join(", ")} against Jev` : "all as Jev had them",
    n.unsure && `${n.unsure} Jev was unsure of`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "3 promos archived · 1 pulled back", or nothing when the promo rule archived none. */
export function promosLine(n: TuneupNewsletter): string | undefined {
  if (!n.promos) return undefined;
  return `${plural(n.promos, "promo")} archived · ${n.pulledBack} pulled back`;
}

/**
 * Weekly tune-up (#26, #159): newsletter rules proposed from Sandip's moves, each with what it
 * would have fixed and what it would move, Apply and Not now; then his corrections per newsletter.
 * Nothing changes until he applies one.
 */
export function Tuneup({ wide }: { wide: boolean }) {
  const { api } = useApp();
  const { senders } = useLibrary();
  const toast = useToast();
  const { state, reload } = useTuneup();
  const href = (h: AuditHeadline) =>
    wide ? queueHref("news", undefined, h.issueId, h.n) : issueHref(h.issueId, h.n);
  const apply = (p: TuneupProposal) =>
    applyProposal(api, p).then(
      () => {
        senders.reload();
        toast.say(`${p.publication} is always ${SHELF[p.shelf]}`);
      },
      (err: Error) => toast.say(err.message),
    );
  const dismiss = (p: TuneupProposal) =>
    dismissProposal(api, p).catch((err: Error) => toast.say(err.message));
  const data = state.status === "ok" ? state.data : undefined;

  return (
    <Page
      title="Tune-up"
      wide={wide}
      sub={
        data &&
        `${plural(corrections(data.totals), "correction")}${
          data.proposals.length ? ` · ${plural(data.proposals.length, "rule")} to look at` : ""
        }`
      }
      class="audit tuneup"
    >
      {state.status === "loading" && <Skeleton />}
      {state.status === "error" && <Failed message={state.error} retry={reload} />}
      {data && (
        <p class="audit-note">
          When you keep moving one newsletter's stories to the same shelf, the rule that would have
          done it for you shows here. Nothing changes until you apply it.
        </p>
      )}
      {data && data.proposals.length > 0 && (
        <section class="audit-group" aria-label="Proposed rules">
          <h2 class="group-label label">Proposed rules · {data.proposals.length}</h2>
          <ul class="audit-list">
            {data.proposals.map((p) => (
              <ProposalRow key={p.id} p={p} href={href} onApply={apply} onDismiss={dismiss} />
            ))}
          </ul>
        </section>
      )}
      {data && data.dismissed > 0 && (
        <p class="audit-note">
          {plural(data.dismissed, "rule")} put off until you move more of{" "}
          {data.dismissed === 1 ? "its newsletter's" : "their newsletters'"} stories.
        </p>
      )}
      {data && !data.newsletters.length && (
        <p class="search-hint">
          Move a story to the other shelf, or bring a promo back out of Archived, and it counts
          here. Three moves one way for one newsletter, and a rule shows up.
        </p>
      )}
      {data && data.newsletters.length > 0 && (
        <section class="audit-group" aria-label="Your corrections">
          <h2 class="group-label label">Your corrections · {data.newsletters.length}</h2>
          <ul class="audit-list">
            {data.newsletters.map((n) => (
              <CorrectionRow key={n.senderId} n={n} />
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}

function Headlines({
  label,
  items,
  href,
}: {
  label: string;
  items: AuditHeadline[];
  href: (h: AuditHeadline) => string;
}) {
  if (!items.length) return null;
  return (
    <>
      <p class="label audit-counts">{label}</p>
      <ul class="audit-only" aria-label={label}>
        {items.map((h) => (
          <li key={`${h.issueId}#${h.n}`}>
            <a href={href(h)}>{h.headline}</a>
          </li>
        ))}
      </ul>
    </>
  );
}

function ProposalRow({
  p,
  href,
  onApply,
  onDismiss,
}: {
  p: TuneupProposal;
  href: (h: AuditHeadline) => string;
  onApply: (p: TuneupProposal) => Promise<void>;
  onDismiss: (p: TuneupProposal) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const run = (act: (p: TuneupProposal) => Promise<void>) => () => {
    setBusy(true);
    void act(p).finally(() => setBusy(false));
  };
  return (
    <li class="audit-card">
      <a class="audit-name" href={newsletterHref(slug(p.publication))}>
        {p.publication}
      </a>
      <p class="tuneup-rule">{ruleLine(p)}</p>
      <p class="audit-why">{whyRule(p)}</p>
      <p class="label audit-counts">{replayLine(p)}</p>
      <Headlines label="You moved" items={p.fixed} href={href} />
      <Headlines label="It would move" items={p.wouldMove} href={href} />
      <div class="audit-actions">
        <button type="button" class="btn fill sm" disabled={busy} onClick={run(onApply)}>
          Apply
        </button>
        <button type="button" class="btn line sm" disabled={busy} onClick={run(onDismiss)}>
          Not now
        </button>
      </div>
    </li>
  );
}

function CorrectionRow({ n }: { n: TuneupNewsletter }) {
  const moves = movesLine(n);
  const promos = promosLine(n);
  return (
    <li class="audit-card">
      <a class="audit-name" href={newsletterHref(slug(n.publication))}>
        {n.publication}
      </a>
      {n.shelf && <p class="audit-why">Always {SHELF[n.shelf]}, by your setting.</p>}
      {moves && <p class="label audit-counts">{moves}</p>}
      {promos && <p class="label audit-counts">{promos}</p>}
    </li>
  );
}
