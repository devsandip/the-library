/** Prefer real Back (keeps list filters and scroll) when we came from inside the app. */
export function backIfPossible(e: MouseEvent) {
  if (history.length > 1 && document.referrer.startsWith(location.origin)) {
    e.preventDefault();
    history.back();
  }
}
