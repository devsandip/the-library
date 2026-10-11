import { useEffect, useState } from "preact/hooks";

/** Up to 760 px the phone's four tabs; above, the Mac's console (the redesign). */
export const WIDE = "(min-width: 761px)";
/** From here the console shows all three panes; below, the story index slides over. */
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
