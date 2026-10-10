import { useEffect, useState } from "preact/hooks";

/** The look changes here (#12): briefing cards below, the sidebar and list layout above. */
export const WIDE = "(min-width: 760px)";
/** Room for a reading pane beside the list. */
export const PANES = "(min-width: 1100px)";

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const update = () => setOn(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [query]);
  return on;
}
