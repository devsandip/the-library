import { useEffect, useState } from "preact/hooks";

/**
 * The theme follows the system; Library > Settings can pin it light or dark. The choice lives in
 * this browser (it is a per-device preference). The stylesheet reads `data-theme` on <html>.
 */
export type ThemePref = "system" | "light" | "dark";

const KEY = "library.theme";
const DARK = "(prefers-color-scheme: dark)";

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
}

export function saveTheme(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Blocked storage: the choice lasts until the page reloads.
  }
  applyTheme(pref);
  window.dispatchEvent(new Event("library-theme"));
}

/** Whether the page is dark right now, by the choice or by the system. */
export function isDark(pref: ThemePref = readTheme()): boolean {
  return pref === "dark" || (pref === "system" && matchMedia(DARK).matches);
}

/** The current choice and whether it comes out dark, kept up to date. */
export function useTheme(): { pref: ThemePref; dark: boolean } {
  const [state, setState] = useState(() => ({ pref: readTheme(), dark: isDark() }));
  useEffect(() => {
    const update = () => setState({ pref: readTheme(), dark: isDark() });
    const m = matchMedia(DARK);
    m.addEventListener("change", update);
    window.addEventListener("library-theme", update);
    return () => {
      m.removeEventListener("change", update);
      window.removeEventListener("library-theme", update);
    };
  }, []);
  return state;
}
