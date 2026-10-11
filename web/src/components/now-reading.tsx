import { useCallback, useEffect, useRef } from "preact/hooks";
import { percent } from "../format.js";
import { useLibrary } from "../library.js";
import { issueHref, queueHref } from "../paths.js";
import { atEnd, placeIn, scrollFor, type FrameView } from "../place.js";

/** Saved at most this often while reading; the last place also goes when the reader leaves. */
const SAVE_EVERY_MS = 5000;
/** Smaller moves are not worth a save. */
const MIN_MOVE = 0.01;
/** How long the place is put back as late images resize the frame, unless the reader moves first. */
const RESTORE_MS = 8000;
/** Input that means the reader is moving the page. */
const INPUTS = ["wheel", "touchstart", "keydown", "mousedown"] as const;

/**
 * One issue's place while it is open (#44). On the first fit of the frame, the reader goes back
 * to where it stopped, again on each fit while late images resize the frame, until the reader
 * moves. From then on the place is saved as it changes; reaching the end saves 1, finished.
 */
class Place {
  private frame?: HTMLIFrameElement;
  private target?: number;
  private deadline = 0;
  private moved = false;
  private finished = false;
  private saved = 0;
  private pending?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private lastSave = 0;
  private readonly docs: Document[] = [];

  constructor(private readonly send: (place: number, keepalive: boolean) => void) {}

  attach() {
    addEventListener("scroll", this.onScroll, { passive: true });
    for (const t of INPUTS) addEventListener(t, this.onInput, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    addEventListener("pagehide", this.onPageHide);
  }

  detach() {
    this.flush(true);
    removeEventListener("scroll", this.onScroll);
    for (const t of INPUTS) removeEventListener(t, this.onInput);
    for (const d of this.docs) for (const t of INPUTS) d.removeEventListener(t, this.onInput);
    document.removeEventListener("visibilitychange", this.onVisibility);
    removeEventListener("pagehide", this.onPageHide);
  }

  fit(frame: HTMLIFrameElement, start: number | undefined) {
    // Input over the newsletter happens in the frame's own document.
    const doc = frame.contentDocument;
    if (doc && !this.docs.includes(doc)) {
      for (const t of INPUTS) doc.addEventListener(t, this.onInput, { passive: true });
      this.docs.push(doc);
    }
    if (!this.frame) {
      this.saved = start ?? 0;
      if (start !== undefined && start > 0 && start < 1) {
        this.target = start;
        this.deadline = Date.now() + RESTORE_MS;
      }
    }
    this.frame = frame;
    const v = this.view();
    if (v && this.target !== undefined && this.restoring()) scrollTo(0, scrollFor(this.target, v));
  }

  private view(): FrameView | undefined {
    const f = this.frame;
    if (!f?.isConnected) return undefined;
    const r = f.getBoundingClientRect();
    return { scrollY, viewport: innerHeight, top: r.top + scrollY, height: r.height };
  }

  private restoring(): boolean {
    return this.target !== undefined && !this.moved && Date.now() < this.deadline;
  }

  private readonly onScroll = () => {
    // While the place is being put back, the scrolling is ours.
    if (this.finished || this.restoring()) return;
    const v = this.view();
    if (!v) return;
    this.moved = true;
    if (atEnd(v)) {
      this.finished = true;
      this.queue(1);
      return;
    }
    const place = placeIn(v);
    if (Math.abs(place - this.saved) >= MIN_MOVE) this.queue(place);
  };

  private readonly onInput = () => {
    this.moved = true;
  };

  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden") this.flush(true);
  };

  private readonly onPageHide = () => this.flush(true);

  private queue(place: number) {
    this.pending = place;
    if (place >= 1) {
      this.flush(false);
      return;
    }
    if (this.timer !== undefined) return;
    const wait = Math.max(0, this.lastSave + SAVE_EVERY_MS - Date.now());
    this.timer = setTimeout(() => this.flush(false), wait);
  }

  private flush(keepalive: boolean) {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending === undefined) return;
    const place = this.pending;
    this.pending = undefined;
    this.saved = place;
    this.lastSave = Date.now();
    this.send(place, keepalive);
  }
}

/**
 * Puts the reader back at its place in an issue and saves the place while it scrolls (#44).
 * `start` is the place the issue opened with; `save` gets each new place (1 means finished),
 * with `keepalive` when the page may be going away. Returns the frame's `onFit`.
 */
export function useReadingPlace(
  id: string,
  start: number | undefined,
  save: (id: string, place: number, keepalive: boolean) => void,
): (frame: HTMLIFrameElement) => void {
  const place = useRef<Place | undefined>(undefined);
  const latest = useRef({ start, save });
  latest.current = { start, save };

  useEffect(() => {
    const p = new Place((value, keepalive) => latest.current.save(id, value, keepalive));
    p.attach();
    place.current = p;
    return () => p.detach();
  }, [id]);

  return useCallback(
    (frame: HTMLIFrameElement) => place.current?.fit(frame, latest.current.start),
    [],
  );
}

/**
 * Continue reading (#44): a pill at the right of every phone header, "↩ Linear 42%" on Today and
 * "↩ 42%" elsewhere. One tap goes back to the issue at its place. Hidden when there is nothing to
 * continue (business rule 19).
 */
export function ContinuePill({ long = false }: { long?: boolean }) {
  const { nowReading } = useLibrary();
  const n = nowReading.data?.nowReading;
  if (!n) return null;
  const pct = percent(n.position);
  return (
    <a
      class={`continue${long ? " long" : ""}`}
      href={issueHref(n.issue.id)}
      aria-label={`Continue reading ${n.issue.subject}, ${pct}% read`}
    >
      <span aria-hidden="true">↩</span>
      {long && <span class="continue-title">{n.issue.subject}</span>}
      <span class={long ? "continue-pct" : undefined}>{pct}%</span>
    </a>
  );
}

/** The Mac's status line: "↩ How Linear builds product · 42%", opening it in the console. */
export function ContinueItem() {
  const { nowReading } = useLibrary();
  const n = nowReading.data?.nowReading;
  if (!n) return null;
  const shelf = n.issue.shelf === "learning" ? "learning" : "news";
  return (
    <a class="status-continue" href={queueHref(shelf, undefined, n.issue.id)}>
      ↩ {n.issue.subject} · {percent(n.position)}%
    </a>
  );
}
