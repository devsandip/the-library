import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type ReaderSettings } from "@library/core/settings";
import { Settings, type EmbeddedInterest } from "../src/settings.js";

function setup(embed = vi.fn(async (text: string) => new Float32Array([text.length, 1]))) {
  const put: EmbeddedInterest[][] = [];
  const store = {
    settings: vi.fn(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn(async (patch: Partial<ReaderSettings>) => ({
      ...DEFAULT_SETTINGS,
      ...patch,
    })),
    putInterestVectors: vi.fn(async (i: EmbeddedInterest[]) => void put.push(i)),
  };
  return { store, put, embed, settings: new Settings(store, { embed }) };
}

describe("settings (#187)", () => {
  it("embeds new interests and keeps their vectors before saving them", async () => {
    const { store, put, embed, settings } = setup();
    const interests = [{ name: "climate", text: "Climate: energy and policy." }];
    const saved = await settings.save({ interests });
    expect(embed).toHaveBeenCalledWith("Climate: energy and policy.");
    expect(put[0]).toEqual([{ ...interests[0], vector: new Float32Array([27, 1]) }]);
    expect(saved.interests).toEqual(interests);
    expect(store.saveSettings).toHaveBeenCalledWith({ interests });
  });

  it("embeds nothing when interests did not change", async () => {
    const { store, embed, settings } = setup();
    await settings.save({ timeZone: "UTC" });
    expect(embed).not.toHaveBeenCalled();
    expect(store.putInterestVectors).not.toHaveBeenCalled();
  });

  it("saves nothing when an embedding fails", async () => {
    const { store, settings } = setup(vi.fn(async () => Promise.reject(new Error("titan down"))));
    await expect(settings.save({ interests: [{ name: "a", text: "b" }] })).rejects.toThrow("titan");
    expect(store.saveSettings).not.toHaveBeenCalled();
  });
});
