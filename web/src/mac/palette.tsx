import { useEffect, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";

export interface Command {
  label: string;
  hint: string;
  href: string;
}

/**
 * ⌘K (and /): search everything, or go to a place by name: History, Newsletters, Status,
 * Settings, the three queues. Typing filters the places; Enter runs the highlighted line, ↑ ↓
 * move, Esc closes.
 */
export function Palette({
  open,
  onClose,
  commands,
  search,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  search: (q: string) => string;
}) {
  const { route } = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setQ("");
      setAt(0);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const text = q.trim();
  const places = commands.filter(
    (c) => !text || c.label.toLowerCase().includes(text.toLowerCase()),
  );
  const lines: Command[] = [
    ...(text
      ? [{ label: `Search for “${text}”`, hint: "Everything you received", href: search(text) }]
      : []),
    ...places,
  ];
  const run = (c: Command | undefined) => {
    if (!c) return;
    dialog.current?.close();
    route(c.href);
  };

  return (
    <dialog
      ref={dialog}
      class="palette"
      aria-label="Search or go to"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close();
      }}
    >
      <input
        type="search"
        class="palette-input"
        placeholder="Search, or go to History, Newsletters, Status…"
        aria-label="Search, or go to a place"
        value={q}
        autoFocus
        onInput={(e) => {
          setQ((e.target as HTMLInputElement).value);
          setAt(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAt((a) => Math.min(a + 1, lines.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAt((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            run(lines[at]);
          }
        }}
      />
      <ul class="palette-list" role="listbox" aria-label="Places">
        {lines.map((c, k) => (
          <li key={c.label} role="option" aria-selected={k === at}>
            <button
              type="button"
              class={`palette-line${k === at ? " on" : ""}`}
              onMouseEnter={() => setAt(k)}
              onClick={() => run(c)}
            >
              <span>{c.label}</span>
              <span class="label">{c.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </dialog>
  );
}
