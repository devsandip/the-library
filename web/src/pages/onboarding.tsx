import { useState } from "preact/hooks";
import {
  aboutFrom,
  PLAIN_LEARNING,
  SETTINGS_LIMITS,
  SUGGESTED_INTERESTS,
  type Interest,
} from "@library/core/settings";
import { useApp } from "../context.js";
import { setReaderZone } from "../zone.js";

const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Every zone the browser knows by name, with `current` among them. */
function zoneNames(current: string): string[] {
  const all = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
    "timeZone",
  ) ?? [current];
  return [...new Set([current, ...all])].sort();
}

const STEPS = ["Your time", "What you read for", "Your newsletters"] as const;

/**
 * Onboarding (#221): a new reader's time zone and interests before the library opens, and a word
 * on getting their newsletters in, which is coming. Finishing saves their settings, with a reader
 * line made from their interests and the plain meaning of Learning.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { api } = useApp();
  const [step, setStep] = useState(0);
  const [zone, setZone] = useState(deviceZone());
  const [picked, setPicked] = useState<Interest[]>([]);
  const [own, setOwn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  // Updates read the latest list, so taps in quick succession all count.
  const toggle = (i: Interest) =>
    setPicked((cur) =>
      cur.some((p) => p.name === i.name)
        ? cur.filter((p) => p.name !== i.name)
        : cur.length < SETTINGS_LIMITS.interests
          ? [...cur, i]
          : cur,
    );
  const addOwn = () => {
    const name = own.replace(/\s+/g, " ").trim().slice(0, SETTINGS_LIMITS.name);
    if (!name) return;
    setPicked((cur) =>
      cur.some((p) => p.name.toLowerCase() === name.toLowerCase()) ||
      cur.length >= SETTINGS_LIMITS.interests
        ? cur
        : [...cur, { name, text: `${name[0]!.toUpperCase()}${name.slice(1)}.` }],
    );
    setOwn("");
  };

  const finish = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const s = await api.saveSettings({
        timeZone: zone,
        interests: picked,
        about: aboutFrom(picked),
        learning: PLAIN_LEARNING,
      });
      setReaderZone(s.timeZone);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <main class="onboarding">
      <div class="onboarding-card">
        <p class="label onboarding-step">
          {step + 1} of {STEPS.length} · {STEPS[step]}
        </p>
        {step === 0 && (
          <>
            <h1 class="onboarding-title">Welcome to Nutgraf</h1>
            <p class="onboarding-text">
              Nutgraf reads your newsletters with you: the best first, the rest sorted, the day in
              brief. First, your time zone, so your days start at your midnight.
            </p>
            <label class="field">
              <select
                aria-label="Time zone"
                value={zone}
                onChange={(e) => setZone(e.currentTarget.value)}
              >
                {zoneNames(zone).map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {step === 1 && (
          <>
            <h1 class="onboarding-title">What do you read for?</h1>
            <p class="onboarding-text">
              Pick a few. Nutgraf ranks your newsletters with them until your thumbs up and down say
              more. You can change them in Settings.
            </p>
            <div class="onboarding-chips" role="group" aria-label="Interests">
              {[
                ...SUGGESTED_INTERESTS,
                ...picked.filter((p) => !SUGGESTED_INTERESTS.some((s) => s.name === p.name)),
              ].map((i) => {
                const on = picked.some((p) => p.name === i.name);
                return (
                  <button
                    key={i.name}
                    type="button"
                    class={`onboarding-chip${on ? " on" : ""}`}
                    aria-pressed={on}
                    onClick={() => toggle(i)}
                  >
                    {i.name}
                  </button>
                );
              })}
            </div>
            <form
              class="field onboarding-own"
              onSubmit={(e) => {
                e.preventDefault();
                addOwn();
              }}
            >
              <input
                aria-label="Another interest"
                placeholder="Another, like sailing"
                maxLength={SETTINGS_LIMITS.name}
                value={own}
                onInput={(e) => setOwn(e.currentTarget.value)}
              />
              <button type="submit" class="link-btn label" disabled={!own.trim()}>
                Add
              </button>
            </form>
          </>
        )}
        {step === 2 && (
          <>
            <h1 class="onboarding-title">Your newsletters</h1>
            <p class="onboarding-text">
              Getting your newsletters into Nutgraf is coming: you'll forward them to a private
              address, or connect Gmail. Until then your library starts empty.
            </p>
          </>
        )}
        {error && <p class="onboarding-error">{error}</p>}
        <div class="onboarding-tools">
          {step > 0 && (
            <button
              type="button"
              class="btn line"
              disabled={saving}
              onClick={() => setStep(step - 1)}
            >
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              class="btn fill"
              disabled={step === 1 && !picked.length}
              onClick={() => setStep(step + 1)}
            >
              Next
            </button>
          ) : (
            <button type="button" class="btn fill" disabled={saving} onClick={() => void finish()}>
              {saving ? "Saving…" : "Open my library"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
