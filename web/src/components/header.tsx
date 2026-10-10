import { BASE } from "../config.js";
import { todayLine } from "../format.js";
import { HistoryIcon, SettingsIcon, SummaryIcon } from "./icons.js";
import { NowReadingLink } from "./now-reading.js";

/**
 * The phone's Home header: the wordmark and today's date, the Summary, History and Status, and
 * under them the issue to come back to (#44).
 */
export function BriefHeader() {
  return (
    <>
      <header class="brief-head">
        <div>
          <a class="wordmark" href={`${BASE}/`}>
            The Library
          </a>
          <p class="dateline">{todayLine()}</p>
        </div>
        <nav class="brief-nav" aria-label="Main">
          <a class="pill" href={`${BASE}/summary`}>
            <SummaryIcon />
            Summary
          </a>
          <a class="icon-button" href={`${BASE}/history`} title="History" aria-label="History">
            <HistoryIcon />
          </a>
          <a class="icon-button" href={`${BASE}/status`} title="Status" aria-label="Status">
            <SettingsIcon />
          </a>
        </nav>
      </header>
      <NowReadingLink wide={false} />
    </>
  );
}
