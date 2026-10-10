import { useEffect, useState } from "preact/hooks";
import type { StatusResponse } from "@library/core/types";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { relativeTime } from "../format.js";

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
  return (
    <section class="status">
      <h1>Status</h1>
      {error && <p class="error">{error}</p>}
      {!status && !error && <p class="muted">Loading...</p>}
      {status && (
        <dl>
          <dt>Signed in as</dt>
          <dd>{auth?.email() ?? "mock user"}</dd>
          <dt>Stage</dt>
          <dd>{status.stage}</dd>
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
