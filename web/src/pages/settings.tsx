import { useEffect, useState } from "preact/hooks";
import { exportFileName } from "@library/core/export";
import { SETTINGS_LIMITS, type Interest, type ReaderSettings } from "@library/core/settings";
import { useToast } from "../components/toast.js";
import { useApp } from "../context.js";
import { saveTheme, useTheme, type ThemePref } from "../theme.js";
import { readerZone, setReaderZone, today } from "../zone.js";
import { Page } from "./page.js";

const THEMES: { id: ThemePref; label: string; note: string }[] = [
  { id: "system", label: "System", note: "Follows the device: light by day, dark at night" },
  { id: "light", label: "Light", note: "Always light" },
  { id: "dark", label: "Dark", note: "Always dark" },
];

/** The device's own time zone, offered when the reader's is another (#188). */
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Two names for one clock, such as Asia/Calcutta and Asia/Kolkata: the same time at midwinter
 * and midsummer, so offering the device's would change nothing.
 */
function sameZone(a: string, b: string): boolean {
  if (a === b) return true;
  const year = new Date().getUTCFullYear();
  const at = (zone: string, month: number) =>
    new Date(Date.UTC(year, month, 1, 12)).toLocaleString("en-GB", { timeZone: zone });
  try {
    return at(a, 0) === at(b, 0) && at(a, 6) === at(b, 6);
  } catch {
    return false;
  }
}

/** Every zone the browser knows by name, or the two that matter when it cannot list them. */
function zoneNames(current: string): string[] {
  const all = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
    "timeZone",
  ) ?? [current, deviceZone()];
  return [...new Set([current, ...all])].sort();
}

/**
 * Settings: the theme follows the system unless it is pinned here, on this device. The reader's
 * time zone and interests (#188) are theirs on every device: the zone sets every day and date in
 * Nutgraf, and the interests seed the Summary's ranking.
 */
export function Settings({ wide }: { wide: boolean }) {
  const { pref } = useTheme();
  const { api } = useApp();
  const toast = useToast();
  const [settings, setSettings] = useState<ReaderSettings>();
  const [interests, setInterests] = useState<Interest[]>([]);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  /** Everything Nutgraf keeps for the reader, saved as a JSON file (#219). */
  const download = async () => {
    setExporting(true);
    try {
      const data = await api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = exportFileName(today());
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast.say((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    api.settings().then(
      (s) => {
        setSettings(s);
        setInterests(s.interests);
      },
      (err: Error) => toast.say(err.message),
    );
  }, []);

  const save = async (patch: Partial<ReaderSettings>, said: string) => {
    setSaving(true);
    try {
      const s = await api.saveSettings(patch);
      setSettings(s);
      setInterests(s.interests);
      setReaderZone(s.timeZone);
      toast.say(said);
    } catch (err) {
      toast.say((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const zone = settings?.timeZone ?? readerZone();
  const here = deviceZone();
  const edited = JSON.stringify(interests) !== JSON.stringify(settings?.interests ?? []);
  const complete = interests.every((i) => i.name.trim() && i.text.trim());
  const change = (k: number, field: keyof Interest, value: string) =>
    setInterests(interests.map((i, n) => (n === k ? { ...i, [field]: value } : i)));

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

      <p class="label section-label">Time zone</p>
      <p class="settings-note">Your days in Nutgraf, and every date and time it shows.</p>
      <label class="field settings-zone">
        <select
          aria-label="Time zone"
          value={zone}
          disabled={!settings || saving}
          onChange={(e) => void save({ timeZone: e.currentTarget.value }, "Time zone saved")}
        >
          {zoneNames(zone).map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      {settings && here && !sameZone(here, zone) && (
        <button
          type="button"
          class="btn line settings-here"
          disabled={saving}
          onClick={() => void save({ timeZone: here }, "Time zone saved")}
        >
          Use this device's: {here.replace(/_/g, " ")}
        </button>
      )}

      <p class="label section-label">Interests</p>
      <p class="settings-note">
        What you care about. The Summary ranks your newsletters with these until your thumbs say
        more.
      </p>
      <ul class="settings-interests">
        {interests.map((i, k) => (
          <li key={k} class="settings-interest">
            <label class="field">
              <input
                aria-label="Interest"
                placeholder="Name, like climate"
                maxLength={SETTINGS_LIMITS.name}
                value={i.name}
                onInput={(e) => change(k, "name", e.currentTarget.value)}
              />
            </label>
            <textarea
              class="settings-text"
              aria-label="What it covers"
              placeholder="A sentence on what it covers"
              maxLength={SETTINGS_LIMITS.text}
              rows={2}
              value={i.text}
              onInput={(e) => change(k, "text", e.currentTarget.value)}
            />
            {interests.length > 1 && (
              <button
                type="button"
                class="settings-remove"
                aria-label={`Remove ${i.name || "this interest"}`}
                onClick={() => setInterests(interests.filter((_, n) => n !== k))}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <div class="settings-tools">
        {interests.length < SETTINGS_LIMITS.interests && (
          <button
            type="button"
            class="btn line"
            disabled={!settings}
            onClick={() => setInterests([...interests, { name: "", text: "" }])}
          >
            Add an interest
          </button>
        )}
        <button
          type="button"
          class="btn"
          disabled={!edited || !complete || saving}
          onClick={() =>
            void save({ interests }, "Interests saved. The Summary ranks with them next time")
          }
        >
          Save interests
        </button>
      </div>

      <p class="label section-label">Your data</p>
      <p class="settings-note">
        Everything Nutgraf keeps for you, as one file: settings, newsletters, issues, highlights and
        history. The newsletters' own text stays in your mail.
      </p>
      <div class="settings-tools">
        <button type="button" class="btn line" disabled={exporting} onClick={() => void download()}>
          {exporting ? "Preparing…" : "Download my data"}
        </button>
      </div>
    </Page>
  );
}
