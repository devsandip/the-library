import { useEffect, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { AskResponse, TimelineSource } from "@library/core/types";
import { useApp } from "../context.js";
import { useAsync } from "../hooks.js";
import { clickInPlace } from "../nav.js";
import { askHref, issueHref, queueHref, searchHref } from "../paths.js";
import { elapsed, useElapsed } from "../timeline.js";
import { Failed } from "../components/ui.js";
import { Page } from "./page.js";

/** What a question costs and how long it takes, from the probe (docs/features/ask.md). */
const SCOPE = "Your newsletters · about 1¢ · 5 to 20 seconds";

/** Answers asked on this visit, by question: coming back to one asks nothing. */
const asked = new Map<string, Promise<AskResponse>>();

/**
 * Ask Nutgraf (#21): a question answered from your newsletters, every paragraph linking to the
 * stories it draws on. The question lives in the URL, so Back and a link bring the answer back;
 * the answer is kept for this visit only, so coming back to it costs nothing, and asking a new
 * question asks again.
 */
export function Ask({ q, wide }: { q: string; wide: boolean }) {
  const { api } = useApp();
  const { route } = useLocation();
  const [text, setText] = useState(q);
  const [since, setSince] = useState<number>();
  const answer = useAsync((): Promise<AskResponse | undefined> => {
    if (!q) return Promise.resolve(undefined);
    let p = asked.get(q);
    if (!p) {
      setSince(Date.now());
      p = api.ask(q);
      asked.set(q, p);
      p.catch(() => asked.delete(q));
    }
    return p;
  }, [q]);
  const secs = useElapsed(answer.status === "loading" && q ? since : undefined);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setText(q), [q]);

  const ask = () => {
    const next = text.replace(/\s+/g, " ").trim();
    if (next.length < 3) return input.current?.focus();
    // The same question again asks again.
    if (next === q) {
      asked.delete(q);
      answer.reload();
    } else route(askHref(next));
  };
  const href = (s: TimelineSource) =>
    wide ? queueHref("news", undefined, s.issueId, s.story?.n) : issueHref(s.issueId, s.story?.n);

  return (
    <Page title="Ask Nutgraf" wide={wide} class="ask">
      <form
        class="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <textarea
          ref={input}
          class="ask-input"
          rows={2}
          maxLength={300}
          aria-label="Ask about anything in your newsletters"
          placeholder="What have my newsletters said about…"
          autoFocus={!q}
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            // Enter asks; Shift+Enter is a new line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
        />
        <div class="ask-bar">
          <span class="label">{SCOPE}</span>
          <button type="submit" class="btn line caps" disabled={answer.status === "loading" && !!q}>
            Ask
          </button>
        </div>
      </form>

      {!q && (
        <p class="search-hint">
          A company, a trend, a week: the answer comes from the stories in your newsletters, with a
          link to every one it uses, and says so when they have nothing on it.
        </p>
      )}
      {q && answer.status === "loading" && (
        <div class="ask-wait" role="status">
          <p class="label">
            <span class="deep-dot" aria-hidden="true" /> Asking · {elapsed(secs)}
          </p>
          <ol class="deep-skeleton" aria-hidden="true">
            <li />
            <li />
            <li />
          </ol>
        </div>
      )}
      {q && answer.status === "error" && <Failed message={answer.error} retry={answer.reload} />}
      {answer.status === "ok" && answer.data && (
        <Answer a={answer.data} href={href} wide={wide} onOpen={(to) => route(to)} />
      )}
    </Page>
  );
}

function Answer({
  a,
  href,
  wide,
  onOpen,
}: {
  a: AskResponse;
  href: (s: TimelineSource) => string;
  wide: boolean;
  onOpen: (to: string) => void;
}) {
  const receipt = [
    a.searches.length ? `Looked for ${a.searches.join(" · ")}` : undefined,
    `${a.stories} ${a.stories === 1 ? "story" : "stories"} read`,
    `${(a.ms / 1000).toFixed(1)} s`,
    `${a.cents}¢`,
  ].filter(Boolean);
  return (
    <article class="ask-answer" aria-live="polite">
      {a.paragraphs.length === 0 ? (
        <div class="empty">
          <p class="empty-text">{a.none}</p>
          <a class="btn line" href={searchHref(a.q)}>
            Search for these words
          </a>
        </div>
      ) : (
        a.paragraphs.map((p, k) => (
          <section key={k} class="ask-paragraph">
            <p>{p.text}</p>
            <ul class="ask-sources" aria-label="From">
              {p.sources.map((s) => (
                <li key={`${s.issueId}#${s.story?.n ?? ""}`}>
                  <a
                    class="chip"
                    href={href(s)}
                    onClick={(e) => {
                      if (wide) clickInPlace(e, () => onOpen(href(s)));
                    }}
                  >
                    {s.publication}
                    {s.story && <span class="ask-story"> · {s.story.headline}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <p class="label ask-receipt">{receipt.join(" · ")}</p>
    </article>
  );
}
