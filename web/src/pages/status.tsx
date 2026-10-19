import { useState } from "preact/hooks";
import type { DigestStats } from "@library/core/types";
import { useApp } from "../context.js";
import { clock, relativeTime } from "../format.js";
import { useLibrary } from "../library.js";
import { health } from "../phone/library-home.js";
import { Failed, Skeleton } from "../components/ui.js";
import { Page } from "./page.js";

/**
 * The success measure in a line (#5): of the five, over the last 14 days, how many got a thumbs
 * up (useful). The aim is 3 in 5.
 */
export function digestLine(s: DigestStats): string {
  const pct = Math.round((100 * s.useful) / s.shown);
  return (
    `Today's five, last 14 days: ${s.useful} of ${s.shown} useful (${pct}%), ` +
    `${s.notUseful} not useful. The aim is 60%.`
  );
}

/** Status: the last Gmail check and what Claude did, the ranking's hit rate, and sign out. */
export function Status({ wide }: { wide: boolean }) {
  const { auth } = useApp();
  const { status, refresh, refreshing } = useLibrary();
  const [asked, setAsked] = useState(false);
  const s = status.data;
  const h = health(s);
  const run = s?.lastRunStats;
  const enrich = s?.lastEnrich;
  const stories = s?.lastStories;

  return (
    <Page
      title="Status"
      wide={wide}
      sub={
        <span class="health">
          {h.tone && <span class={`dot ${h.tone}`} aria-hidden="true" />}
          {h.word}
          {h.at && ` · ${h.at}`}
        </span>
      }
    >
      {status.status === "loading" && <Skeleton rows={3} />}
      {status.status === "error" && <Failed message={status.error} retry={status.reload} />}
      {s && (
        <dl class="facts">
          <dt>Signed in as</dt>
          <dd>{auth?.email() ?? "mock user"}</dd>
          <dt>Stage</dt>
          <dd>{s.stage}</dd>
          {s.digestStats && s.digestStats.shown > 0 && (
            <>
              <dt>Ranking</dt>
              <dd>{digestLine(s.digestStats)}</dd>
            </>
          )}
          <dt>Last check</dt>
          <dd>
            {s.lastRunAt ? `${clock(s.lastRunAt)}, ${relativeTime(s.lastRunAt)}` : "Not yet run"}
          </dd>
          {run && (
            <>
              <dt>Last run</dt>
              <dd>
                {run.newsletters} new, {run.filtered} filtered, {run.alreadyStored} already stored,{" "}
                {run.errors} errors
              </dd>
            </>
          )}
          {s.lastError && (
            <>
              <dt>Last error</dt>
              <dd class="irr">{s.lastError}</dd>
            </>
          )}
          {enrich && (
            <>
              <dt>Claude</dt>
              <dd>
                {enrich.classified} sorted, {enrich.embedded} embedded
                {enrich.accountFiltered > 0 && `, ${enrich.accountFiltered} account mail filtered`}
                {enrich.waitingForTopics > 0 &&
                  `, ${enrich.waitingForTopics} waiting for the topic list`}
                {enrich.deferred > 0 && `, ${enrich.deferred} left for the next run`}
                {`, ${enrich.errors} errors`}
              </dd>
              {enrich.errorSamples.length > 0 && (
                <>
                  <dt>Claude error</dt>
                  <dd class="irr">{enrich.errorSamples[0]}</dd>
                </>
              )}
            </>
          )}
          {stories && (
            <>
              <dt>Stories</dt>
              <dd>
                {stories.storied} issues split into {stories.stories} stories, {stories.linked}{" "}
                joined an event from another issue
                {stories.deferred > 0 && `, ${stories.deferred} left for the next run`}
                {`, ${stories.errors} errors`}
              </dd>
              {stories.errorSamples.length > 0 && (
                <>
                  <dt>Story error</dt>
                  <dd class="irr">{stories.errorSamples[0]}</dd>
                </>
              )}
            </>
          )}
        </dl>
      )}
      <div class="page-actions">
        <button
          type="button"
          class="btn fill"
          disabled={refreshing}
          onClick={() => {
            setAsked(true);
            void refresh();
          }}
        >
          {refreshing ? "Checking Gmail…" : "Check Gmail now"}
        </button>
        {auth && (
          <button type="button" class="btn line" onClick={() => void auth.signOut()}>
            Sign out
          </button>
        )}
      </div>
      {asked && !refreshing && <p class="page-note">Checked. New issues are in the lists.</p>}
    </Page>
  );
}
