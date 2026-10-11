import { saveTheme, useTheme, type ThemePref } from "../theme.js";
import { Page } from "./page.js";

const THEMES: { id: ThemePref; label: string; note: string }[] = [
  { id: "system", label: "System", note: "Follows the device: light by day, dark at night" },
  { id: "light", label: "Light", note: "Always light" },
  { id: "dark", label: "Dark", note: "Always dark" },
];

/** Settings: the theme follows the system unless it is pinned here, on this device. */
export function Settings({ wide }: { wide: boolean }) {
  const { pref } = useTheme();
  return (
    <Page title="Settings" wide={wide}>
      <p class="label section-label">Theme · this device</p>
      <div class="options" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={pref === t.id}
            class={`option${pref === t.id ? " on" : ""}`}
            onClick={() => saveTheme(t.id)}
          >
            <span>{t.label}</span>
            <span class="label">{t.note}</span>
          </button>
        ))}
      </div>
    </Page>
  );
}
