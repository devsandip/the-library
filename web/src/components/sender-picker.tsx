import { useEffect, useRef, useState } from "preact/hooks";
import type { SenderListItem } from "@library/core/types";
import { BASE } from "../config.js";
import { SearchIcon, StarIcon } from "./icons.js";

/**
 * Pick one or more newsletters (#9): a bottom sheet on the phone. The Mac lists senders in its
 * sidebar instead. Done or the main button applies; Escape or a tap outside leaves the filter as
 * it was.
 */
export function SenderPicker({
  open,
  senders,
  counts,
  picked,
  unreadView,
  onApply,
  onClose,
}: {
  open: boolean;
  senders: SenderListItem[];
  /** Unread per sender in the current tab and topics. */
  counts: Map<string, number>;
  picked: string[];
  /** The numbers are unread counts, so the button only promises a number in Unread. */
  unreadView: boolean;
  onApply: (senderIds: string[]) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(picked));
  const [search, setSearch] = useState("");

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setSelected(new Set(picked));
      setSearch("");
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  const apply = () => {
    onApply(senders.filter((s) => selected.has(s.senderId)).map((s) => s.senderId));
  };
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const q = search.trim().toLowerCase();
  const shown = senders.filter((s) => !q || s.publication.toLowerCase().includes(q));
  const starred = shown.filter((s) => s.mustRead);
  const others = shown.filter((s) => !s.mustRead);
  const n = (ids: Iterable<string>) => [...ids].reduce((sum, id) => sum + (counts.get(id) ?? 0), 0);
  const allUnread = n(senders.filter((s) => !s.muted).map((s) => s.senderId));
  const chosen = selected.size;
  const cta = unreadView
    ? chosen
      ? `Show ${n(selected)} ${n(selected) === 1 ? "issue" : "issues"} from ${chosen}`
      : `Show all ${allUnread} issues`
    : chosen
      ? `Show ${chosen} ${chosen === 1 ? "newsletter" : "newsletters"}`
      : "Show all newsletters";

  const row = (s: SenderListItem) => (
    <label class="pick-row" key={s.senderId}>
      <input
        type="checkbox"
        checked={selected.has(s.senderId)}
        onChange={() => toggle(s.senderId)}
      />
      <span class="pick-name">
        {s.publication}
        {s.muted && <span class="muted"> · muted</span>}
      </span>
      <span class="pick-count">{counts.get(s.senderId) ?? 0}</span>
    </label>
  );

  return (
    <dialog
      ref={dialog}
      class="sheet"
      aria-label="Filter by sender"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog itself.
        if (e.target === dialog.current) dialog.current?.close();
      }}
    >
      <div class="sheet-inner">
        <span class="sheet-handle" aria-hidden="true" />
        <div class="sheet-head">
          <h2>Filter by sender</h2>
          <button type="button" class="link" onClick={apply}>
            Done
          </button>
        </div>
        <label class="search">
          <SearchIcon />
          <input
            type="search"
            aria-label="Search newsletters"
            placeholder="Search newsletters"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          />
        </label>
        <div class="sheet-body">
          {starred.length > 0 && (
            <>
              <h3 class="group-heading">
                <StarIcon filled /> Must Read
              </h3>
              {starred.map(row)}
            </>
          )}
          {others.length > 0 && (
            <>
              <h3 class="group-heading">All newsletters</h3>
              {others.map(row)}
            </>
          )}
          {shown.length === 0 && <p class="muted">No newsletter matches "{search.trim()}".</p>}
          <a class="manage-link" href={`${BASE}/senders`}>
            Manage senders: star, mute, always News or Learning
          </a>
        </div>
        <div class="sheet-foot">
          <button type="button" class="link" onClick={() => setSelected(new Set())}>
            Clear
          </button>
          <button type="button" class="pill primary" onClick={apply}>
            {cta}
          </button>
        </div>
      </div>
    </dialog>
  );
}
