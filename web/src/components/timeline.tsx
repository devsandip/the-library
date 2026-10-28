import type { ComponentChildren } from "preact";
import type { SourceCheck, SourceHop, SourceRun, TimelineSource } from "@library/core/types";
import { clock, shortDate } from "../format.js";
import { clickInPlace } from "../nav.js";
import {
  elapsed,
  useElapsed,
  useSource,
  useTakes,
  useTimeline,
  type DeepState,
} from "../timeline.js";

/** A deep-dive tab's mark (P4): ✓ kept, ● writing. */
export function DeepMark({ state }: { state: DeepState<unknown> }) {
  if (state.status === "kept") {
    return (
      <span class="deep-mark kept" aria-label="kept">
        ✓
      </span>
    );
  }
  if (state.status === "writing") {
    return (
      <span class="deep-mark writing" aria-label="writing">
        ●
      </span>
    );
  }
  return null;
}

/** "Today 07:58 · 4 s · 0.4¢": when it was written, how long it took and what it cost. */
function receipt(t: { at: string; ms: number; cents: number }): string {
  const day = shortDate(t.at);
  return `Written ${day} ${clock(t.at)} · ${Math.max(1, Math.round(t.ms / 1000))} s · ${t.cents || "<0.1"}¢`;
}

/** Where a deep dive's links go, and how a click opens them in place on the Mac. */
export interface Links {
  href: (issueId: string, story?: number) => string;
  onOpen?: (issueId: string, story?: number) => void;
}

/** A link to the issue a source is from, at its story inside a digest. */
export function SourceLink({
  s,
  links,
  children,
}: {
  s: TimelineSource;
  links: Links;
  children: ComponentChildren;
}) {
  return (
    <a
      href={links.href(s.issueId, s.story?.n)}
      onClick={(e) => {
        const open = links.onOpen;
        if (open) clickInPlace(e, () => open(s.issueId, s.story?.n));
      }}
    >
      {children}
    </a>
  );
}

/**
 * A deep dive's tab (P4), whatever its kind. Idle, it says what it does and what it costs, with
 * Run: it never runs on its own. Writing, a ticking status over skeleton lines. Kept, the
 * result, its receipt and Write again. In the Mac's story index it is compact, written by a key.
 */
function DeepPanel<T extends { at: string; ms: number; cents: number }>({
  name,
  desc,
  scope,
  cost,
  doing = "Writing",
  keptFor = "event",
  deep,
  compact,
  progress,
  children,
}: {
  name: string;
  desc: string;
  scope: string;
  cost: string;
  /** What the status line says while it runs. */
  doing?: string;
  /** What it is kept for: the event (timeline, takes) or the story (a source check). */
  keptFor?: "event" | "story";
  deep: { state: DeepState<T>; write: () => void; retry: () => void };
  compact: boolean;
  /** For a run in the background (#129): what shows under the status line, from its pages. */
  progress?: (run: Omit<SourceRun, "since">) => ComponentChildren;
  children: (value: T) => ComponentChildren;
}) {
  const { state, write, retry } = deep;
  const secs = useElapsed(state.status === "writing" ? state.since : undefined);
  const cls = `deep${compact ? " compact" : ""}`;
  const title = !compact && <p class="deep-title">{name}</p>;

  switch (state.status) {
    case "loading":
      return compact ? null : (
        <div class={cls}>
          <p class="related-none">Looking…</p>
        </div>
      );
    case "error":
      return (
        <div class={cls}>
          <p class="related-none">{state.error}</p>
          <button type="button" class="link-btn label deep-again" onClick={retry}>
            Try again
          </button>
        </div>
      );
    case "idle":
      if (compact) {
        return state.none ? (
          <div class={cls}>
            <p class="related-none">{state.none}</p>
          </div>
        ) : null;
      }
      return (
        <div class={cls}>
          {title}
          <p class="deep-desc">{desc}</p>
          <p class="label deep-scope">{scope}</p>
          {state.none && <p class="related-none deep-none">{state.none}</p>}
          <button type="button" class="btn fill deep-run" onClick={write}>
            Run · {cost}
          </button>
          <p class="deep-foot">
            Runs only when you ask. Kept for this story afterwards, so a second look is free.
          </p>
        </div>
      );
    case "writing":
      return (
        <div class={cls} aria-busy="true">
          <div class="deep-head">
            {title}
            <span class="label deep-status">
              <span class="deep-dot" aria-hidden="true" />
              {doing} · {elapsed(secs)}
            </span>
          </div>
          {!compact && <p class="label deep-scope">{scope}</p>}
          {state.run && progress?.(state.run)}
          <ol class="deep-skeleton" aria-hidden="true">
            <li />
            <li />
            {!compact && <li />}
          </ol>
          {!compact && (
            <p class="deep-foot">Keep reading; it fills in here and stays on this story.</p>
          )}
        </div>
      );
    case "kept":
      return (
        <div class={cls}>
          {title}
          {children(state.value)}
          <p class="label deep-receipt">
            {receipt(state.value)}
            {compact ? "" : ` · kept for this ${keptFor}, free to reopen`}
          </p>
          <button type="button" class="link-btn label deep-again" onClick={write}>
            Write again · {cost}
          </button>
        </div>
      );
  }
}

/**
 * How this evolved (#19), the Timeline tab: the gist and the dated points, each opening the
 * issue that first carried it. Compact on the Mac: a date column and the text, written with L.
 */
export function TimelinePanel({
  id,
  n,
  compact = false,
  ...links
}: { id: string; n: number; compact?: boolean } & Links) {
  return (
    <DeepPanel
      name="How this evolved"
      desc="This story against the last four weeks of your newsletters, step by step, each step linked to the issue that carried it."
      scope="Your newsletters · last 4 weeks · ~1¢ · a few seconds"
      cost="~1¢"
      deep={useTimeline(id, n)}
      compact={compact}
    >
      {(t) => (
        <>
          <p class="deep-gist">{t.gist}</p>
          <ol class={`timeline${compact ? " compact" : ""}`}>
            {t.points.map((p, k) => {
              const pubs = [...new Set(p.sources.map((s) => s.publication))].join(", ");
              return (
                <li key={k} class={p.current ? "current" : undefined}>
                  <SourceLink s={p.sources[0]!} links={links}>
                    <span class="timeline-when label">
                      {shortDate(p.at)}
                      {!compact && ` · ${pubs}`}
                      {!compact && p.current && " · This story"}
                    </span>
                    <span class="timeline-text">
                      {p.text}
                      {compact && <span class="timeline-pub"> · {pubs}</span>}
                    </span>
                  </SourceLink>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </DeepPanel>
  );
}

/**
 * What your newsletters say (#17), the Takes tab: the gist, then the newsletters grouped by where
 * they land, each one's sentence opening its story. Compact on the Mac, written with T.
 */
export function TakesPanel({
  id,
  n,
  compact = false,
  ...links
}: { id: string; n: number; compact?: boolean } & Links) {
  return (
    <DeepPanel
      name="What your newsletters say"
      desc="How each of your newsletters covered this, side by side and grouped by where they land, each take linked to its story."
      scope="Your newsletters · the same news · ~1¢ · a few seconds"
      cost="~1¢"
      deep={useTakes(id, n)}
      compact={compact}
    >
      {(t) => (
        <>
          <p class="deep-gist">{t.gist}</p>
          {t.groups.map((g) => (
            <section key={g.label} class={`takes-group${compact ? " compact" : ""}`}>
              <p class="label takes-label">{g.label}</p>
              <ul class="takes">
                {g.takes.map((take) => (
                  <li
                    key={`${take.source.issueId}#${take.source.story?.n ?? ""}`}
                    class={take.current ? "current" : undefined}
                  >
                    <SourceLink s={take.source} links={links}>
                      <span class="takes-pub label">
                        {take.source.publication}
                        {take.current && " · This story"}
                      </span>
                      <span class="takes-text">{take.text}</span>
                    </SourceLink>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </DeepPanel>
  );
}

/** A verdict in words. */
export const VERDICT: Record<SourceCheck["verdict"], string> = {
  holds: "Holds up",
  further: "Goes further than the source",
  missing: "Not in the source",
  mixed: "Mixed",
};

/** A page's host, without "www.". */
const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/**
 * The pages a check tried on its way to the original (#128), in order from the story's link:
 * each host linked, what the page before called it, the original marked, and why a page could
 * not be read. On the Mac, one line of hosts.
 */
function SourcePath({
  path,
  reading,
  compact,
}: {
  path: SourceHop[];
  /** The page being read now, while the check runs. */
  reading?: string;
  compact: boolean;
}) {
  if (compact) {
    return (
      <p class="label source-path-line">
        {path.map((p, k) => (
          <span key={k} class={p.failed ? "source-failed" : undefined}>
            {k > 0 && " → "}
            {host(p.url)}
          </span>
        ))}
        {reading && `${path.length ? " → " : ""}${host(reading)}…`}
      </p>
    );
  }
  return (
    <ol class="source-path">
      {path.map((p, k) => (
        <li key={k} class={p.failed ? "source-failed" : p.what ? "source-original" : undefined}>
          <a href={p.url} target="_blank" rel="noopener noreferrer">
            {host(p.url)} ↗
          </a>
          <span class="source-why">
            {p.failed
              ? ` · could not be read: ${p.failed}`
              : p.what
                ? ` · the original: ${p.what}`
                : k === 0
                  ? " · the story's link"
                  : p.why
                    ? ` · ${p.why}`
                    : ""}
          </span>
        </li>
      ))}
      {reading && <li class="source-reading">Reading {host(reading)}…</li>}
    </ol>
  );
}

/** What a check was made against: the original, or the story's own page when none was found. */
function against(c: SourceCheck): string {
  const pages = c.path?.length ?? 1;
  if (c.original)
    return pages > 1 ? "Checked against the original" : "The story links to the original";
  if (pages > 1) return `No original in ${pages} pages: checked against the story's link`;
  return "Checked against the page the story links to";
}

/**
 * Check the source (#23), the Source tab: the overall verdict and the page checked, the way there
 * when the check followed links to the original (#128), then each claim with its verdict, what
 * the page says and the page's own words. While it runs, the page being read and those read so
 * far. Compact on the Mac, run with C.
 */
export function SourcePanel({
  id,
  n,
  compact = false,
}: {
  id: string;
  n: number;
  compact?: boolean;
}) {
  return (
    <DeepPanel
      name="Check the source"
      desc="What this story claims against its original: the page it links to, or the paper, filing or post that page cites, up to five pages on. Each claim with what the original says, its own words, and whether it holds up."
      scope="The page it links to and what it cites · ~2¢ · under a minute"
      cost="~2¢"
      doing="Checking"
      keptFor="story"
      deep={useSource(id, n)}
      compact={compact}
      progress={(run) => (
        <SourcePath path={run.pages ?? []} reading={run.reading} compact={compact} />
      )}
    >
      {(c) => (
        <>
          <p class={`source-verdict ${c.verdict}`}>{VERDICT[c.verdict]}</p>
          <p class="label source-page">
            {c.original !== undefined && `${against(c)} · `}
            <a href={c.url} target="_blank" rel="noopener noreferrer">
              {host(c.url)} ↗
            </a>
          </p>
          {c.path && c.path.length > 1 && <SourcePath path={c.path} compact={compact} />}
          {c.note && <p class="deep-gist">{c.note}</p>}
          <ul class={`source-claims${compact ? " compact" : ""}`}>
            {c.claims.map((claim, k) => (
              <li key={k} class={claim.verdict}>
                <p class="label source-claim-verdict">{VERDICT[claim.verdict]}</p>
                <p class="source-claim">{claim.claim}</p>
                <p class="source-says">{claim.source}</p>
                {claim.quote && <blockquote class="source-quote">“{claim.quote}”</blockquote>}
              </li>
            ))}
          </ul>
        </>
      )}
    </DeepPanel>
  );
}
