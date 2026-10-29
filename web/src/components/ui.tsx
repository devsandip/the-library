import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useLibrary } from "../library.js";

/** "No new numbers.": an empty list reads as being done, not as an error. */
export function Empty({
  title = "No new numbers.",
  children,
}: {
  title?: string;
  children?: ComponentChildren;
}) {
  return (
    <div class="empty">
      <p class="empty-title">{title}</p>
      {children}
    </div>
  );
}

/** Loading: skeleton rows with a row's own metrics; still under reduced motion. */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div class="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, k) => (
        <div class="skeleton-row" key={k}>
          <span class="bar meta" />
          <span class="bar title" />
          <span class="bar line" />
        </div>
      ))}
    </div>
  );
}

export function Failed({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div class="failed">
      <p>{message}</p>
      {retry && (
        <button type="button" class="btn line sm" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** The next page loads as the end of the list comes into view; the button is there for keyboards. */
export function LoadMore({
  has,
  loading,
  onMore,
}: {
  has: boolean;
  loading: boolean;
  onMore: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onMore);
  latest.current = onMore;
  useEffect(() => {
    const el = ref.current;
    if (!el || !has || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && latest.current(),
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [has]);
  if (!has) return null;
  return (
    <div class="load-more" ref={ref}>
      <button type="button" class="btn line sm" onClick={onMore} disabled={loading}>
        {loading ? "Loading…" : "More"}
      </button>
    </div>
  );
}

/** How far down a pull must go before letting go refreshes. */
const PULL_PX = 72;

/**
 * Pull to refresh on Today and Browse: drag down from the top of the page and let go. It asks
 * for a Gmail check and reloads the lists when it lands.
 */
export function PullToRefresh() {
  const { refresh, refreshing } = useLibrary();
  const [pull, setPull] = useState(0);
  const start = useRef<{ y: number; x: number } | undefined>(undefined);
  const latest = useRef(0);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1 || scrollY > 0) return;
      // Not from inside a sheet or a dialog.
      if ((e.target as Element | null)?.closest("dialog, .sheet, .deck")) return;
      start.current = { y: t.clientY, x: t.clientX };
    };
    const onMove = (e: TouchEvent) => {
      const s = start.current;
      const t = e.touches[0];
      if (!s || !t) return;
      const dy = t.clientY - s.y;
      if (dy <= 0 || scrollY > 0 || Math.abs(t.clientX - s.x) > dy) {
        start.current = undefined;
        latest.current = 0;
        setPull(0);
        return;
      }
      // Resistance: the indicator moves at half the finger's speed.
      latest.current = Math.min(dy / 2, PULL_PX * 1.4);
      setPull(latest.current);
    };
    const onEnd = () => {
      if (!start.current) return;
      start.current = undefined;
      if (latest.current >= PULL_PX) void refresh();
      latest.current = 0;
      setPull(0);
    };
    addEventListener("touchstart", onStart, { passive: true });
    addEventListener("touchmove", onMove, { passive: true });
    addEventListener("touchend", onEnd);
    addEventListener("touchcancel", onEnd);
    return () => {
      removeEventListener("touchstart", onStart);
      removeEventListener("touchmove", onMove);
      removeEventListener("touchend", onEnd);
      removeEventListener("touchcancel", onEnd);
    };
  }, [refresh]);

  if (!pull && !refreshing) return null;
  const armed = pull >= PULL_PX;
  return (
    <div
      class={`pull label${refreshing ? " busy" : ""}`}
      style={refreshing ? undefined : { height: `${pull}px` }}
      role="status"
    >
      {refreshing ? "Checking Gmail…" : armed ? "Let go to check" : "Pull to check"}
    </div>
  );
}

/**
 * A bottom sheet (the Topics, Senders and Show sheets, a highlight's): a modal dialog, so focus
 * stays inside and Escape closes it; a tap on the scrim closes it too. Changes apply live; Clear
 * resets that part and Done closes. `class` adds to the sheet's own.
 */
export function Sheet({
  open,
  title,
  onClose,
  onClear,
  children,
  tall = false,
  class: extra,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onClear?: () => void;
  children: ComponentChildren;
  tall?: boolean;
  class?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      class={`sheet${tall ? " tall" : ""}${extra ? ` ${extra}` : ""}`}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        // A click on the scrim lands on the dialog itself.
        if (e.target === dialog.current) dialog.current?.close();
      }}
    >
      <div class="sheet-inner">
        <span class="grabber" aria-hidden="true" />
        <div class="sheet-head">
          {onClear ? (
            <button type="button" class="sheet-clear" onClick={onClear}>
              Clear
            </button>
          ) : (
            <span />
          )}
          <h2 class="sheet-title">{title}</h2>
          <button type="button" class="sheet-done" onClick={() => dialog.current?.close()}>
            Done
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
