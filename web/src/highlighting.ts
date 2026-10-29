import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { HIGHLIGHT_MAX } from "@library/core/highlights";
import type { Highlight, HighlightQuote, IssueDetailResponse } from "@library/core/types";
import { locate, pieces, quoteAt, textIndex, type NodeLike, type TextIndex } from "./anchor.js";
import { useApp } from "./context.js";
import type { AsyncHandle } from "./hooks.js";
import { useToast } from "./components/toast.js";

/** The class of a highlight's marks in the frame; the frame's stylesheet colours it. */
export const MARK = "nutgraf-hl";
/** Highlight stays this long after the selection goes: a tap on it can clear the selection first. */
const LINGER_MS = 400;
/** The selection is read again this long after it stops changing, for when it is gone by the tap. */
const SETTLE_MS = 150;

type Run = TextIndex<Text>["runs"][number];
/**
 * A selection as a quote. `repeats` when its quote would find the same words, context and all,
 * earlier in the page: 32 characters either side cannot tell every repeat apart.
 */
export interface Selected {
  quote: HighlightQuote;
  repeats: boolean;
}
const NONE: Highlight[] = [];

/**
 * The highlights in a frame's page (#167): marked where their quotes are found, the selection
 * read as a quote, H and a click on a mark heard in the frame's own document, where the reader's
 * keys and clicks do not reach.
 */
class Marker {
  private doc?: Document;
  private highlights: Highlight[] = [];
  private index: TextIndex<Text> = { text: "", runs: [] };
  private runOf = new Map<Node, Run>();
  private quote?: Selected;
  private showing = false;
  private linger?: ReturnType<typeof setTimeout>;
  private settle?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly on: {
      selecting: (has: boolean) => void;
      open: (id: string) => void;
      keep: () => void;
      lost: (ids: string[]) => void;
    },
  ) {}

  /** A frame fitted to its content: a new page is marked, and listened to. */
  fit(frame: HTMLIFrameElement) {
    const doc = frame.contentDocument;
    if (!doc?.body || doc === this.doc) return;
    this.detach();
    this.doc = doc;
    doc.addEventListener("selectionchange", this.onSelection);
    doc.addEventListener("click", this.onClick);
    doc.addEventListener("keydown", this.onKey);
    this.paint();
  }

  detach() {
    clearTimeout(this.linger);
    clearTimeout(this.settle);
    const doc = this.doc;
    if (!doc) return;
    doc.removeEventListener("selectionchange", this.onSelection);
    doc.removeEventListener("click", this.onClick);
    doc.removeEventListener("keydown", this.onKey);
    this.doc = undefined;
  }

  show(highlights: Highlight[]) {
    this.highlights = highlights;
    this.paint();
  }

  /** Marks every highlight afresh: the old marks out, each quote found, its text wrapped. */
  private paint() {
    const doc = this.doc;
    if (!doc?.body) return;
    const parents = new Set<Node>();
    for (const m of doc.querySelectorAll(`mark.${MARK}`)) {
      const p = m.parentNode;
      if (!p) continue;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      parents.add(p);
    }
    for (const p of parents) p.normalize();

    // Every quote is found before any is marked: marking splits the text nodes found.
    const index = textIndex(doc.body as Node as NodeLike) as TextIndex<Text>;
    const cover = new Map<Text, { from: number; to: number; id: string }[]>();
    const lost: string[] = [];
    for (const h of this.highlights) {
      const at = locate(index.text, h);
      if (!at) {
        lost.push(h.id);
        continue;
      }
      for (const p of pieces(index, at.start, at.end)) {
        cover.set(p.node, [...(cover.get(p.node) ?? []), { ...p, id: h.id }]);
      }
    }
    for (const [node, ps] of cover) wrap(doc, node, ps);
    this.reindex();
    this.on.lost(lost);
  }

  private reindex() {
    const body = this.doc?.body;
    this.index = body
      ? (textIndex(body as Node as NodeLike) as TextIndex<Text>)
      : { text: "", runs: [] };
    this.runOf = new Map(this.index.runs.map((r) => [r.node, r]));
  }

  /** The selection in the page as a quote, if one is selected. */
  private selected(): Selected | undefined {
    const sel = this.doc?.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return undefined;
    const r = sel.getRangeAt(0);
    const start = this.offset(r.startContainer, r.startOffset, "start");
    const end = this.offset(r.endContainer, r.endOffset, "end");
    if (start === undefined || end === undefined || end <= start) return undefined;
    const text = this.index.text;
    const quote = quoteAt(text, start, end);
    if (!quote) return undefined;
    const first = start + text.slice(start).search(/\S/);
    return { quote, repeats: locate(text, quote)?.start !== first };
  }

  /** A point in the page as a place in its text; between elements, the nearest text inside. */
  private offset(node: Node, offset: number, edge: "start" | "end"): number | undefined {
    const run = this.runOf.get(node);
    if (run) return run.start + offset;
    const doc = this.doc;
    if (!doc) return undefined;
    try {
      const point = doc.createRange();
      point.setStart(node, offset);
      const runs = this.index.runs;
      if (edge === "start") return runs.find((x) => point.comparePoint(x.node, 0) >= 0)?.start;
      for (let i = runs.length - 1; i >= 0; i--) {
        if (point.comparePoint(runs[i]!.node, 0) < 0) return runs[i]!.end;
      }
    } catch {
      // A point outside the page's body.
    }
    return undefined;
  }

  private set(showing: boolean) {
    if (showing === this.showing) return;
    this.showing = showing;
    this.on.selecting(showing);
  }

  private readonly onSelection = () => {
    const sel = this.doc?.getSelection();
    const has = Boolean(sel && !sel.isCollapsed && /\S/.test(sel.toString()));
    clearTimeout(this.settle);
    if (has) {
      clearTimeout(this.linger);
      this.linger = undefined;
      this.set(true);
      this.settle = setTimeout(() => (this.quote = this.selected() ?? this.quote), SETTLE_MS);
      return;
    }
    if (!this.showing || this.linger) return;
    this.linger = setTimeout(() => {
      this.linger = undefined;
      this.quote = undefined;
      this.set(false);
    }, LINGER_MS);
  };

  private readonly onClick = (e: MouseEvent) => {
    const mark = (e.target as Element | null)?.closest?.<HTMLElement>(`mark.${MARK}`);
    // A mark inside a link stays a link.
    if (!mark || mark.closest("a")) return;
    if (this.doc?.getSelection()?.isCollapsed === false) return;
    if (mark.dataset.hl) this.on.open(mark.dataset.hl);
  };

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== "h" || e.metaKey || e.ctrlKey || e.altKey || !this.showing) return;
    e.preventDefault();
    this.on.keep();
  };

  /** Takes the selected passage, clearing the selection: the one selected now, or a moment ago. */
  take(): Selected | undefined {
    const q = this.selected() ?? this.quote;
    this.doc?.getSelection()?.removeAllRanges();
    clearTimeout(this.linger);
    clearTimeout(this.settle);
    this.linger = undefined;
    this.quote = undefined;
    this.set(false);
    return q;
  }

  /** Scrolls a highlight to the middle of the screen; false when it is not marked. */
  reveal(id: string): boolean {
    const m = this.doc?.querySelector(`mark.${MARK}[data-hls~="${CSS.escape(id)}"]`);
    if (!m) return false;
    m.scrollIntoView({ block: "center" });
    return true;
  }
}

/**
 * Wraps the parts of a text node that highlights cover. Where two overlap, the part they share
 * opens the later one (the last in the list, which is oldest first) and names both.
 */
function wrap(doc: Document, node: Text, ps: { from: number; to: number; id: string }[]) {
  const cuts = [...new Set([0, node.length, ...ps.flatMap((p) => [p.from, p.to])])].sort(
    (a, b) => a - b,
  );
  // From the end back, so the node keeps the text before each cut.
  for (let k = cuts.length - 2; k >= 0; k--) {
    const a = cuts[k]!;
    const b = cuts[k + 1]!;
    const ids = ps.filter((p) => p.from <= a && p.to >= b).map((p) => p.id);
    const part = a === 0 ? node : node.splitText(a);
    if (!ids.length) continue;
    const mark = doc.createElement("mark");
    mark.className = MARK;
    mark.dataset.hl = ids[ids.length - 1]!;
    mark.dataset.hls = ids.join(" ");
    part.parentNode?.insertBefore(mark, part);
    mark.appendChild(part);
  }
}

/** What the reader shows and does with an issue's highlights (#167). */
export interface Highlighting {
  /** Whether a passage is selected in the page, so Highlight shows. */
  selecting: boolean;
  /** Keeps the selected passage; false when none is selected. */
  keep: () => boolean;
  /** The highlight whose note is open. */
  editing?: Highlight;
  edit: (id: string | undefined) => void;
  /** Sets a highlight's note; blank clears it. */
  note: (id: string, note: string) => void;
  remove: (id: string) => void;
  /** Highlights whose passage the page no longer holds, listed under the issue. */
  lost: Highlight[];
}

/**
 * An open issue's highlights: marked in its frame (`fit`, on each fit of the frame), kept from a
 * selection, noted and removed. `hl` is a highlight to open the issue at (from the Highlights
 * page): `jump` puts the reader there instead of at the saved place.
 */
export function useHighlighting(
  issue: AsyncHandle<IssueDetailResponse>,
  hl?: string,
): Highlighting & { fit: (frame: HTMLIFrameElement) => void; jump?: () => boolean } {
  const { api } = useApp();
  const toast = useToast();
  const [selecting, setSelecting] = useState(false);
  const [editingId, edit] = useState<string>();
  const [lostIds, setLost] = useState<string[]>([]);
  const highlights = issue.data?.highlights ?? NONE;
  const latest = useRef({ issue, highlights, keep: (): boolean => false });
  const marker = useRef<Marker | undefined>(undefined);
  marker.current ??= new Marker({
    selecting: setSelecting,
    open: edit,
    keep: () => latest.current.keep(),
    lost: setLost,
  });
  const [target] = useState(hl);

  useEffect(() => () => marker.current?.detach(), []);
  useEffect(() => marker.current?.show(highlights), [highlights]);

  const change = (fn: (hs: Highlight[]) => Highlight[]) =>
    latest.current.issue.set((d) => ({ ...d, highlights: fn(d.highlights ?? []) }));
  const add = (h: Highlight) => change((hs) => (hs.some((x) => x.id === h.id) ? hs : [...hs, h]));

  const keep = () => {
    const d = latest.current.issue.data;
    const sel = d && marker.current?.take();
    if (!d || !sel) return false;
    const q = sel.quote;
    if (sel.repeats) {
      toast.say("Those words repeat in this issue. Select a few more to keep them");
      return true;
    }
    if (q.exact.length > HIGHLIGHT_MAX) {
      toast.say(`Too long to keep: ${HIGHLIGHT_MAX.toLocaleString("en-GB")} characters at most`);
      return true;
    }
    const tap = matchMedia("(pointer: coarse)").matches ? "Tap" : "Click";
    api.addHighlight(d.id, q).then(
      (h) => {
        add(h);
        toast.say(`Highlighted. ${tap} it for a note`, {
          label: "Undo",
          run: () => remove(h.id, true),
        });
      },
      (err: Error) => toast.say(err.message),
    );
    return true;
  };

  const remove = (id: string, undoing = false) => {
    const was = latest.current.highlights.find((h) => h.id === id);
    if (!was) return;
    change((hs) => hs.filter((h) => h.id !== id));
    edit(undefined);
    api.deleteHighlight(id).then(
      () => {
        if (undoing) return;
        // Undone by keeping the passage again, note and all.
        toast.say("Highlight removed", {
          label: "Undo",
          run: () =>
            void api.addHighlight(was.issueId, was, was.note).then(add, (err: Error) => {
              toast.say(err.message);
            }),
        });
      },
      (err: Error) => {
        add(was);
        toast.say(err.message);
      },
    );
  };

  const note = (id: string, text: string) => {
    const was = latest.current.highlights.find((h) => h.id === id);
    const next = text.trim();
    // Gone already (removed from its sheet), or unchanged.
    if (!was || (was.note ?? "") === next) return;
    const put = (h: Highlight) => change((hs) => hs.map((x) => (x.id === id ? h : x)));
    const { note: _old, ...rest } = was;
    put(next ? { ...rest, note: next } : rest);
    api.setHighlightNote(id, next || null).then(put, (err: Error) => {
      put(was);
      toast.say(err.message);
    });
  };

  latest.current = { issue, highlights, keep };
  const fit = useCallback((frame: HTMLIFrameElement) => marker.current?.fit(frame), []);
  const jump = useCallback(() => (target ? marker.current!.reveal(target) : false), [target]);

  return {
    selecting,
    keep,
    editing: highlights.find((h) => h.id === editingId),
    edit,
    note,
    remove,
    lost: highlights.filter((h) => lostIds.includes(h.id)),
    fit,
    jump: target ? jump : undefined,
  };
}
