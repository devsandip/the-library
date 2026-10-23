import { clock, shortDate } from "../format.js";
import { clickInPlace } from "../nav.js";
import { elapsed, useElapsed, useTimeline, type TimelineState } from "../timeline.js";

const SCOPE = "Your newsletters · last 4 weeks · ~1¢ · a few seconds";

/** A deep-dive tab's mark (P4): ✓ kept, ● writing. */
export function TimelineMark({ state }: { state: TimelineState }) {
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

/**
 * How this evolved (#19), the Timeline tab (P4). Idle, it says what it does and what it costs,
 * with Run: it never runs on its own. Writing, a ticking status over skeleton points. Kept, the
 * gist and the dated points, each opening the issue that first carried it, then the receipt. In
 * the Mac's story index it is compact: a date column and the text, written with L.
 */
export function TimelinePanel({
  id,
  n,
  href,
  onOpen,
  compact = false,
}: {
  id: string;
  n: number;
  href: (issueId: string, story?: number) => string;
  onOpen?: (issueId: string, story?: number) => void;
  compact?: boolean;
}) {
  const { state, write, retry } = useTimeline(id, n);
  const secs = useElapsed(state.status === "writing" ? state.since : undefined);
  const cls = `deep${compact ? " compact" : ""}`;
  const title = !compact && <p class="deep-title">How this evolved</p>;

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
          <p class="deep-desc">
            This story against the last four weeks of your newsletters, step by step, each step
            linked to the issue that carried it.
          </p>
          <p class="label deep-scope">{SCOPE}</p>
          {state.none && <p class="related-none deep-none">{state.none}</p>}
          <button type="button" class="btn fill deep-run" onClick={write}>
            Run · ~1¢
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
              Writing · {elapsed(secs)}
            </span>
          </div>
          {!compact && <p class="label deep-scope">{SCOPE}</p>}
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
    case "kept": {
      const t = state.timeline;
      return (
        <div class={cls}>
          {title}
          <p class="deep-gist">{t.gist}</p>
          <ol class={`timeline${compact ? " compact" : ""}`}>
            {t.points.map((p, k) => {
              const first = p.sources[0]!;
              const pubs = [...new Set(p.sources.map((s) => s.publication))].join(", ");
              return (
                <li key={k} class={p.current ? "current" : undefined}>
                  <a
                    href={href(first.issueId, first.story?.n)}
                    onClick={(e) => {
                      if (onOpen) clickInPlace(e, () => onOpen(first.issueId, first.story?.n));
                    }}
                  >
                    <span class="timeline-when label">
                      {shortDate(p.at)}
                      {!compact && ` · ${pubs}`}
                      {!compact && p.current && " · This story"}
                    </span>
                    <span class="timeline-text">
                      {p.text}
                      {compact && <span class="timeline-pub"> · {pubs}</span>}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
          <p class="label deep-receipt">
            {receipt(t)}
            {compact ? "" : " · kept for this event, free to reopen"}
          </p>
          <button type="button" class="link-btn label deep-again" onClick={write}>
            Write again · ~1¢
          </button>
        </div>
      );
    }
  }
}
