import { readerDay } from "@library/core/days";
import type { StatusResponse } from "@library/core/types";
import { useApp } from "../context.js";
import { clock } from "../format.js";
import { useFollowing } from "../following.js";
import { HIGHLIGHTS } from "../features.js";
import { highlightCount, useHighlights } from "../highlights.js";
import { usePredictions } from "../predictions.js";
import { dropCount, useAudit } from "../audit.js";
import { useTuneup, waitingCount } from "../tuneup.js";
import { useAsync } from "../hooks.js";
import { useLibrary } from "../library.js";
import {
  askHref,
  auditHref,
  tuneupHref,
  followingHref,
  highlightsHref,
  predictionsHref,
  historyHref,
  newslettersHref,
  searchHref,
  settingsHref,
  statusHref,
} from "../paths.js";
import { useTheme } from "../theme.js";
import { SearchIcon } from "../components/icons.js";
import { ContinuePill } from "../components/now-reading.js";

/** A check is due every two hours from 06:00 to 22:00 IST; overnight runs none for eight. */
const LATE_MS = 10 * 3_600_000;

/** "Healthy · 12:30", "Late · 02:10", or "Error": the last Gmail check at a glance. */
export function health(s: StatusResponse | undefined): { word: string; tone: string; at?: string } {
  if (!s) return { word: "…", tone: "" };
  const at = s.lastRunAt ? clock(s.lastRunAt) : undefined;
  if (s.lastError) return { word: "Error", tone: "irr", at };
  if (!s.lastRunAt) return { word: "Not run yet", tone: "" };
  if (Date.now() - Date.parse(s.lastRunAt) > LATE_MS) return { word: "Late", tone: "verdict", at };
  return { word: "Healthy", tone: "rel", at };
}

/**
 * Library (P6): Search on top, then Ask, Following, Highlights, Predictions, History, Newsletters,
 * Subscription audit, Tune-up, Status and Settings;
 * under them the places still to come. New destinations arrive here, so the tab bar never grows.
 */
export function LibraryHome() {
  const { api } = useApp();
  const { senders, status } = useLibrary();
  const { pref } = useTheme();
  const today = readerDay(Date.now());
  const followed = useFollowing().state;
  const following =
    followed.status === "ok"
      ? { unseen: followed.data.unseen, count: followed.data.items.length }
      : { unseen: 0, count: 0 };
  const kept = highlightCount(useHighlights(HIGHLIGHTS ? "once" : "never").state);
  const predicted = usePredictions("open", false).state;
  const audited = useAudit("once").state;
  const drop = dropCount(audited);
  const waiting = waitingCount(useTuneup("once").state);
  const history = useAsync(() => api.history(today), [today], `history:${today}`);
  const all = senders.data?.items ?? [];
  const h = health(status.data);

  return (
    <section class="library">
      <header class="screen-head">
        <h1 class="screen-title">Library</h1>
        <ContinuePill />
      </header>
      <a class="field search-link" href={searchHref()}>
        <SearchIcon size={18} />
        <span>Search everything you received</span>
      </a>
      <nav class="group" aria-label="Library">
        <a class="group-row" href={askHref()}>
          <span class="group-name">Ask Nutgraf</span>
          <span class="label">About 1¢ a question</span>
          <span class="chev" aria-hidden="true">
            ›
          </span>
        </a>
        <a class="group-row" href={followingHref()}>
          <span class="group-name">Following</span>
          <span class={`label${following.unseen ? " follow-new" : ""}`}>
            {following.unseen
              ? `${following.unseen} new`
              : following.count
                ? `${following.count} ${following.count === 1 ? "story" : "stories"}`
                : "Stories you track"}
          </span>
          <span class="chev" aria-hidden="true">
            ›
          </span>
        </a>
        {HIGHLIGHTS && (
          <a class="group-row" href={highlightsHref()}>
            <span class="group-name">Highlights</span>
            <span class="label">
              {kept === undefined ? "Passages you kept" : kept ? `${kept} kept` : "None yet"}
            </span>
            <span class="chev" aria-hidden="true">
              ›
            </span>
          </a>
        )}
        <a class="group-row" href={predictionsHref()}>
          <span class="group-name">Predictions</span>
          <span
            class={`label${predicted.status === "ok" && predicted.data.due ? " follow-new" : ""}`}
          >
            {predicted.status !== "ok"
              ? "Who called it"
              : predicted.data.due
                ? `${predicted.data.due} due`
                : `${predicted.data.items.length} open`}
          </span>
          <span class="chev" aria-hidden="true">
            ›
          </span>
        </a>
        <a class="group-row" href={historyHref()}>
          <span class="group-name">History</span>
          <span class="label">{history.data ? `${history.data.items.length} today` : ""}</span>
          <span class="chev" aria-hidden="true">
            ›
          </span>
        </a>
        <a class="group-row" href={newslettersHref()}>
          <span class="group-name">Newsletters</span>
          <span class="label">
            {all.length > 0 && `${all.length} · ${all.filter((s) => s.mustRead).length} ★`}
          </span>
          <span class="chev" aria-hidden="true">
            ›
          </span>
        </a>
        <a class="group-row" href={auditHref()}>
          <span class="group-name">Subscription audit</span>
          <span class={`label${drop ? " follow-new" : ""}`}>
            {drop === undefined
              ? "Keep or drop"
              : drop
                ? `${drop} worth dropping`
                : "Nothing to drop"}
          </span>
          <span class="chev" aria-hidden="true">
            ›
          </span>
        </a>
        <a class="group-row" href={tuneupHref()}>
          <span class="group-name">Tune-up</span>
          <span class={`label${waiting ? " follow-new" : ""}`}>
            {waiting === undefined
              ? "Rules from your moves"
              : waiting
                ? `${waiting} ${waiting === 1 ? "rule" : "rules"} to look at`
                : "Nothing to change"}
          </span>
          <span class="chev" aria-hidden="true">
            ›
          </span>
        </a>
        <a class="group-row" href={statusHref()}>
          <span class="group-name">Status</span>
          <span class="label health">
            {h.tone && <span class={`dot ${h.tone}`} aria-hidden="true" />}
            {h.word}
            {h.at && ` · ${h.at}`}
          </span>
          <span class="chev" aria-hidden="true">
            ›
          </span>
        </a>
        <a class="group-row" href={settingsHref()}>
          <span class="group-name">Settings</span>
          <span class="label">Theme: {pref}</span>
          <span class="chev" aria-hidden="true">
            ›
          </span>
        </a>
      </nav>
      <p class="group-label label">Coming later</p>
      <ul class="group later" aria-label="Coming later">
        <li class="group-row">
          <span class="group-name">Watch</span>
          <span class="label">The daily video</span>
        </li>
      </ul>
    </section>
  );
}
