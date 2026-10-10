import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { SenderListItem } from "@library/core/types";
import { BASE } from "../config.js";
import { facets } from "../counts.js";
import { homeHref, readFilters, SHELVES, type HomeFilters } from "../filters.js";
import { useLibrary } from "../library.js";
import { ChevronIcon, SearchIcon, StarIcon } from "./icons.js";

const toggle = <T,>(list: T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

type Section = "topics" | "senders";

/** The sections folded shut, remembered in this browser. */
const FOLDED_KEY = "library.sidebar.folded";

function readFolded(): Section[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((s): s is Section => s === "topics" || s === "senders") : [];
  } catch {
    return []; // Blocked storage or a bad value: everything starts open.
  }
}

/** A heading that folds the section under it. Clear stays on it, folded or not. */
function SectionHead(props: {
  section: Section;
  label: string;
  open: boolean;
  picked: number;
  onFold: () => void;
  onClear: () => void;
}) {
  const { section, label, open, picked, onFold, onClear } = props;
  return (
    <h2 class="side-label">
      <button
        type="button"
        class="side-fold"
        aria-expanded={open}
        aria-controls={`side-${section}`}
        onClick={onFold}
      >
        <ChevronIcon />
        {label}
        {!open && picked > 0 && <span class="n">{picked} picked</span>}
      </button>
      {picked > 0 && (
        <button type="button" class="link" onClick={onClear}>
          Clear
        </button>
      )}
    </h2>
  );
}

/**
 * The Mac's left column (#12, two-pane): News and Learning, the Summary, topic chips (#10) and
 * the sender filter (#9). It sets Home's filters through the URL, from any page.
 */
export function Sidebar() {
  const { path, query, route } = useLocation();
  const { topics, senders, counts } = useLibrary();
  const [search, setSearch] = useState("");
  const [folded, setFolded] = useState(readFolded);
  const fold = (s: Section) => {
    const next = toggle(folded, s);
    setFolded(next);
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify(next));
    } catch {
      // Blocked storage: the fold lasts until the page reloads.
    }
  };

  // preact-iso drops the trailing slash: Home's path is "/thelibrary".
  const home = path === (BASE || "/");
  const f = readFilters(home ? query : {});
  // The tabs appear once Claude has proposed topics and started sorting (`pnpm topics`).
  const shelvesOn = (topics.data?.topics.length ?? 0) > 0;
  const all = senders.data?.items ?? [];
  const muted = new Set(all.filter((s) => s.muted).map((s) => s.senderId));
  const tally = counts.data
    ? facets(
        counts.data.counts,
        { shelf: shelvesOn ? f.shelf : undefined, senders: f.senders, topics: f.topics },
        muted,
      )
    : undefined;

  const go = (next: Partial<HomeFilters>) => route(homeHref({ ...f, ...next }));

  // Claude's topic order; topics with nothing unread here drop out unless they are on.
  const chips = (topics.data?.topics ?? [])
    .map((t) => ({
      name: t.name,
      n: tally?.topics.get(t.name) ?? 0,
      on: f.topics.includes(t.name),
    }))
    .filter((t) => t.on || t.n > 0 || !tally);

  const q = search.trim().toLowerCase();
  const shown = all.filter((s) => !q || s.publication.toLowerCase().includes(q));
  const ordered = [...shown.filter((s) => s.mustRead), ...shown.filter((s) => !s.mustRead)];

  const sender = (s: SenderListItem) => (
    <li key={s.senderId}>
      <label class={`side-sender${s.muted ? " is-muted" : ""}`}>
        <input
          type="checkbox"
          checked={f.senders.includes(s.senderId)}
          onChange={() => go({ senders: toggle(f.senders, s.senderId) })}
        />
        <span class="name">
          {s.publication}
          {s.muted && <span class="muted"> · muted</span>}
        </span>
        {s.mustRead && (
          <span class="star" title="Must Read">
            <StarIcon filled />
            <span class="sr-only">Must Read</span>
          </span>
        )}
        {tally && <span class="n">{tally.senders.get(s.senderId) ?? 0}</span>}
      </label>
    </li>
  );

  return (
    <aside class="sidebar" aria-label="Library">
      <a class="wordmark" href={`${BASE}/`}>
        The Library
      </a>

      <nav class="side-nav" aria-label="Main">
        {shelvesOn ? (
          SHELVES.map((s) => {
            const on = home && f.shelf === s.id;
            return (
              <a
                key={s.id}
                class={on ? "on" : ""}
                aria-current={on ? "page" : undefined}
                // Topics belong to a tab, so switching clears them; picked senders stay.
                href={homeHref({ ...f, shelf: s.id, topics: [] })}
              >
                <span>{s.label}</span>
                {tally && <span class="n">{tally.shelves[s.id]}</span>}
              </a>
            );
          })
        ) : (
          <a class={home ? "on" : ""} aria-current={home ? "page" : undefined} href={`${BASE}/`}>
            <span>Unread</span>
            {tally && <span class="n">{tally.total}</span>}
          </a>
        )}
        <a
          class={path === `${BASE}/summary` ? "on" : ""}
          aria-current={path === `${BASE}/summary` ? "page" : undefined}
          href={`${BASE}/summary`}
        >
          <span>Summary</span>
        </a>
        <a
          class={path === `${BASE}/history` ? "on" : ""}
          aria-current={path === `${BASE}/history` ? "page" : undefined}
          href={`${BASE}/history`}
        >
          <span>History</span>
        </a>
      </nav>

      {chips.length > 0 && (
        <>
          <SectionHead
            section="topics"
            label="Topics"
            open={!folded.includes("topics")}
            picked={f.topics.length}
            onFold={() => fold("topics")}
            onClear={() => go({ topics: [] })}
          />
          <div
            id="side-topics"
            class="side-chips"
            role="group"
            aria-label="Topics"
            hidden={folded.includes("topics")}
          >
            {chips.map((t) => (
              <button
                key={t.name}
                type="button"
                class={`chip${t.on ? " on" : ""}`}
                aria-pressed={t.on}
                onClick={() => go({ topics: toggle(f.topics, t.name) })}
              >
                {t.name}
                {!t.on && tally && <span class="n">{t.n}</span>}
              </button>
            ))}
          </div>
        </>
      )}

      <SectionHead
        section="senders"
        label="Senders"
        open={!folded.includes("senders")}
        picked={f.senders.length}
        onFold={() => fold("senders")}
        onClear={() => go({ senders: [] })}
      />
      <div id="side-senders" hidden={folded.includes("senders")}>
        <label class="search side-search">
          <SearchIcon />
          <input
            type="search"
            aria-label="Search senders"
            placeholder="Search senders"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          />
        </label>
        <ul class="side-senders" aria-label="Senders">
          {ordered.map(sender)}
        </ul>
        {all.length > 0 && shown.length === 0 && (
          <p class="muted small side-none">No newsletter matches "{search.trim()}".</p>
        )}
      </div>

      <nav class="side-foot" aria-label="More">
        <a href={`${BASE}/senders`}>Manage senders</a>
        <a href={`${BASE}/status`}>Status</a>
      </nav>
    </aside>
  );
}
