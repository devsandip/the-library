/**
 * A reader's settings (#184, #187). Saving interests embeds them at once, so the Summary ranks
 * with them on its next read; a reader who never set interests ranks with today's
 * (`CONFIG/INTERESTS`, embedded by enrichment).
 */
import type { ReaderSettings, SettingsAnswer } from "@library/core/settings";
import type { Embedder } from "./search.js";

/** An interest with its Titan embedding. */
export interface EmbeddedInterest {
  name: string;
  text: string;
  vector: Float32Array;
}

export interface SettingsStore {
  settings(): Promise<ReaderSettings>;
  /** Whether the reader has been through onboarding (#221). */
  onboarded(): Promise<boolean>;
  saveSettings(patch: Partial<ReaderSettings>): Promise<ReaderSettings>;
  /** The reader's own interest vectors (`READER#<id>` / `INTERESTS`). */
  putInterestVectors(interests: EmbeddedInterest[]): Promise<void>;
}

export interface SettingsPort {
  get(): Promise<SettingsAnswer>;
  save(patch: Partial<ReaderSettings>): Promise<SettingsAnswer>;
}

export class Settings implements SettingsPort {
  constructor(
    private readonly store: SettingsStore,
    private readonly embedder: Embedder,
  ) {}

  async get(): Promise<SettingsAnswer> {
    const [settings, onboarded] = await Promise.all([
      this.store.settings(),
      this.store.onboarded(),
    ]);
    return { ...settings, onboarded };
  }

  async save(patch: Partial<ReaderSettings>): Promise<SettingsAnswer> {
    // Embedded first: when Titan fails, nothing is saved and the reader can try again.
    if (patch.interests) {
      const embedded = await Promise.all(
        patch.interests.map(async (i) => ({ ...i, vector: await this.embedder.embed(i.text) })),
      );
      await this.store.putInterestVectors(embedded);
    }
    // Saved settings are what onboarding ends with.
    return { ...(await this.store.saveSettings(patch)), onboarded: true };
  }
}
