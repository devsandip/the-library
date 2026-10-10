/** Prefer real Back (keeps list filters and scroll) when we came from inside the app. */
export function backIfPossible(e: MouseEvent) {
  if (history.length > 1 && document.referrer.startsWith(location.origin)) {
    e.preventDefault();
    history.back();
  }
}

/**
 * Handle a plain click on a link in place (the reading pane) instead of following it. Modified
 * clicks keep the browser's own behaviour (new tab, new window). The click must not reach
 * preact-iso's window listener: it follows every in-scope link and ignores preventDefault.
 */
export function clickInPlace(e: MouseEvent, handle: () => void) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  e.stopPropagation();
  handle();
}
