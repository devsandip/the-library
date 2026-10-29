import { useState } from "preact/hooks";
import type {
  Prediction,
  PredictionStatus,
  PredictionView,
  TrackRecord,
} from "@library/core/types";
import { today as todayInZone } from "../zone.js";
import { useApp } from "../context.js";
import { shortDate } from "../format.js";
import { issueHref, predictionsHref, queueHref } from "../paths.js";
import { setVerdict, usePredictions } from "../predictions.js";
import { useToast } from "../components/toast.js";
import { Failed } from "../components/ui.js";
import { Page } from "./page.js";

/** A verdict in words, and its tone. */
export const VERDICT: Record<Exclude<PredictionStatus, "open">, { word: string; tone: string }> = {
  right: { word: "Right", tone: "rel" },
  wrong: { word: "Wrong", tone: "irr" },
  unclear: { word: "Unclear", tone: "muted" },
};

/** "3 right · 1 wrong · 2 open": a newsletter's own calls (#24). */
export function recordLine(r: TrackRecord): string {
  return [
    r.right && `${r.right} right`,
    r.wrong && `${r.wrong} wrong`,
    r.unclear && `${r.unclear} unclear`,
    r.open && `${r.open} open`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Who called it (#24, #141): open predictions by due date, the due ones marked, and settled ones
 * latest first with their verdict, its sentence and the stories that show it. Every verdict can
 * be overruled, or handed back to the morning's settling.
 */
export function Predictions({ view, wide }: { view: PredictionView; wide: boolean }) {
  const { api } = useApp();
  const toast = useToast();
  const { state, reload } = usePredictions(view);
  const today = todayInZone();
  const href = (id: string, n?: number) =>
    wide ? queueHref("news", undefined, id, n) : issueHref(id, n);
  const set = (p: Prediction, verdict: Exclude<PredictionStatus, "open"> | null) =>
    setVerdict(api, p, verdict).then(
      () =>
        toast.say(
          verdict ? `Marked ${VERDICT[verdict].word.toLowerCase()}` : "Handed back to settling",
        ),
      (err: Error) => toast.say(err.message),
    );
  const items = state.status === "ok" ? state.data.items : [];
  const due = state.status === "ok" ? state.data.due : 0;

  return (
    <Page
      title="Predictions"
      wide={wide}
      sub={state.status === "ok" ? sub(view, items.length, due) : undefined}
      class="predictions"
    >
      <nav class="predictions-views" aria-label="Which predictions">
        <a class={`chip${view === "open" ? " on" : ""}`} href={predictionsHref("open")}>
          Open
        </a>
        <a class={`chip${view === "settled" ? " on" : ""}`} href={predictionsHref("settled")}>
          Settled
        </a>
      </nav>
      {state.status === "loading" && (
        <ol class="deep-skeleton" aria-hidden="true">
          <li />
          <li />
        </ol>
      )}
      {state.status === "error" && <Failed message={state.error} retry={reload} />}
      {state.status === "ok" && !items.length && (
        <p class="search-hint">
          {view === "open"
            ? "Dated forecasts and promises from your newsletters show here as they arrive, by when they come due."
            : "Each morning the ones that came due are settled from what your newsletters said since: right, wrong or unclear."}
        </p>
      )}
      <ul class="predictions-list">
        {items.map((p) => (
          <PredictionRow key={p.id} p={p} today={today} href={href} onSet={set} />
        ))}
      </ul>
    </Page>
  );
}

const sub = (view: PredictionView, n: number, due: number) =>
  view === "open" ? `${n} open${due ? ` · ${due} due` : ""}` : `${n} settled`;

function PredictionRow({
  p,
  today,
  href,
  onSet,
}: {
  p: Prediction;
  today: string;
  href: (id: string, n?: number) => string;
  onSet: (p: Prediction, v: Exclude<PredictionStatus, "open"> | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const act = (v: Exclude<PredictionStatus, "open"> | null) => {
    setBusy(true);
    void onSet(p, v).finally(() => setBusy(false));
  };
  const isDue = p.status === "open" && p.due <= today;
  const verdict = p.status === "open" ? undefined : VERDICT[p.status];
  return (
    <li class={`prediction${isDue ? " due" : ""}`}>
      <p class="label prediction-meta">
        {verdict ? (
          <span class={`prediction-verdict ${verdict.tone}`}>
            {verdict.word}
            {p.setBy && " · your call"}
          </span>
        ) : (
          <span class={isDue ? "prediction-due" : undefined}>
            Due {shortDate(`${p.due}T12:00:00Z`)}
            {isDue && " · settles in the morning"}
          </span>
        )}
        {" · "}
        {p.who}
        {p.own && " (its own call)"}
      </p>
      <p class="prediction-text">{p.text}</p>
      <blockquote class="prediction-quote">
        “{p.quote}”{" "}
        <a class="label" href={href(p.issueId, p.n)}>
          {p.publication}, {shortDate(p.saidAt)}
        </a>
      </blockquote>
      {p.why && <p class="prediction-why">{p.why}</p>}
      {p.evidence && p.evidence.length > 0 && (
        <ul class="prediction-evidence">
          {p.evidence.map((e) => (
            <li key={`${e.issueId}#${e.n}`}>
              <a href={href(e.issueId, e.n)}>
                <span class="label">
                  {shortDate(e.receivedAt)} · {e.publication}
                </span>{" "}
                {e.headline}
              </a>
            </li>
          ))}
        </ul>
      )}
      <div class="prediction-actions" aria-label="Your verdict">
        {(["right", "wrong", "unclear"] as const).map((v) => (
          <button
            key={v}
            type="button"
            class={`link-btn label${p.setBy && p.status === v ? " on" : ""}`}
            disabled={busy || (p.setBy !== undefined && p.status === v)}
            onClick={() => act(v)}
          >
            {VERDICT[v].word}
          </button>
        ))}
        {p.setBy && (
          <button type="button" class="link-btn label" disabled={busy} onClick={() => act(null)}>
            Hand back
          </button>
        )}
      </div>
    </li>
  );
}
