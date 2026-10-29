import { useEffect, useState } from "preact/hooks";
import { NOTE_MAX } from "@library/core/highlights";
import type { Highlighting } from "../highlighting.js";
import { Sheet } from "./ui.js";

/**
 * Highlight (#167), while a passage is selected in the page: over the phone's action bar, at the
 * foot of the Mac's reader with its key. Pressing it does not take the selection away first.
 */
export function HighlightButton({ h, wide = false }: { h: Highlighting; wide?: boolean }) {
  if (!h.selecting) return null;
  return (
    <button
      type="button"
      class={`hl-button${wide ? " wide" : ""}`}
      aria-keyshortcuts={wide ? "H" : undefined}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => h.keep()}
    >
      {wide && <span class="k">H</span>}
      Highlight
    </button>
  );
}

/** A highlight's sheet: its passage, a note kept on Done, and Remove. */
export function HighlightSheet({ h }: { h: Highlighting }) {
  const e = h.editing;
  const [draft, setDraft] = useState("");
  useEffect(() => setDraft(e?.note ?? ""), [e?.id]);
  return (
    <Sheet
      open={e !== undefined}
      title="Highlight"
      class="hl"
      onClose={() => {
        if (e) h.note(e.id, draft);
        h.edit(undefined);
      }}
    >
      {e && (
        <div class="hl-sheet">
          <blockquote class="hl-quote">{e.exact}</blockquote>
          <label class="label" for="hl-note">
            Note
          </label>
          <textarea
            id="hl-note"
            class="hl-note"
            rows={4}
            maxLength={NOTE_MAX}
            placeholder="Why it matters, or what to do with it"
            value={draft}
            onInput={(ev) => setDraft((ev.target as HTMLTextAreaElement).value)}
          />
          <button type="button" class="btn line hl-remove" onClick={() => h.remove(e.id)}>
            Remove highlight
          </button>
        </div>
      )}
    </Sheet>
  );
}

/** Under the page: highlights whose passage it no longer holds, kept rather than lost. */
export function LostHighlights({ h }: { h: Highlighting }) {
  if (!h.lost.length) return null;
  return (
    <section class="hl-lost" aria-label="Highlights the page no longer shows">
      <p class="label">Highlights the page no longer shows</p>
      {h.lost.map((x) => (
        <button type="button" key={x.id} class="hl-lost-item" onClick={() => h.edit(x.id)}>
          <span class="hl-passage">{x.exact}</span>
          {x.note && <span class="hl-passage-note">{x.note}</span>}
        </button>
      ))}
    </section>
  );
}
