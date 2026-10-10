import { useEffect, useState } from "preact/hooks";
import type { StatusResponse } from "@library/core/types";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { digestLine, relativeTime } from "../format.js";
import { backIfPossible } from "../nav.js";
import { BackIcon } from "../components/icons.js";

export function Status() {
  const { api, auth } = useApp();
  const [status, setStatus] = useState<StatusResponse>();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

  const load = () => api.status().then(setStatus, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.refreshNow();
    } finally {
      setRefreshing(false);
    }
  };

  const stats = status?.lastRunStats;
  const enrich = status?.lastEnrich;
  const stories = status?.lastStories;
  return (
    <section class="status">
      <a class="back" href={`${BASE}/`} onClick={backIfPossible}>
        <BackIcon /> Library
      </a>
      <h1>Status</h1>
      {error && <p class="error">{error}</p>}
      {!status && !error && <p class="muted">Loading...</p>}
      {status && (
        <dl>
          <dt>Signed in as</dt>
          <dd>{auth?.email() ?? "mock user"}</dd>
          <dt>Stage</dt>
          <dd>{status.stage}</dd>
          {status.digestStats && status.digestStats.shown > 0 && (
            <>
              <dt>Ranking</dt>
              <dd>{digestLine(status.digestStats)}</dd>
            </>
          )}
          <dt>Last check</dt>
          <dd>{status.lastRunAt ? relativeTime(status.lastRunAt) : "Not yet run"}</dd>
          {stats && (
            <>
              <dt>Last run</dt>
              <dd>
                {stats.newsletters} new, {stats.filtered} filtered, {stats.alreadyStored} already
                stored, {stats.errors} errors
              </dd>
            </>
          )}
          {status.lastError && (
            <>
              <dt>Last error</dt>
              <dd class="error">{status.lastError}</dd>
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
                  <dd class="error">{enrich.errorSamples[0]}</dd>
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
                  <dd class="error">{stories.errorSamples[0]}</dd>
                </>
              )}
            </>
          )}
        </dl>
      )}
      <div class="status-actions">
        <button type="button" onClick={refresh} disabled={refreshing}>
          {refreshing ? "Checking..." : "Check for new issues"}
        </button>
        <a class="pill" href={`${BASE}/senders`}>
          Senders
        </a>
        {auth && (
          <button type="button" onClick={() => void auth.signOut()}>
            Sign out
          </button>
        )}
      </div>
    </section>
  );
}
