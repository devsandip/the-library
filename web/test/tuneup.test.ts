import { describe, expect, it, vi } from "vitest";
import type { TuneupNewsletter, TuneupProposal, TuneupResponse } from "@library/core/types";
import type { LibraryApi } from "../src/api.js";
import {
  applyProposal,
  dismissProposal,
  readTuneup,
  tuneupState,
  waitingCount,
} from "../src/tuneup.js";
import {
  corrections,
  movesLine,
  promosLine,
  replayLine,
  ruleLine,
  whyRule,
} from "../src/pages/tuneup.js";

const proposal = (o: Partial<TuneupProposal> = {}): TuneupProposal => ({
  id: "sA.learning",
  senderId: "sA",
  publication: "Alpha",
  shelf: "learning",
  fixes: 3,
  moves: 1,
  stories: 12,
  onShelf: 11,
  fixed: [],
  wouldMove: [],
  ...o,
});

const row = (o: Partial<TuneupNewsletter> = {}): TuneupNewsletter => ({
  senderId: "sA",
  publication: "Alpha",
  stories: 12,
  learning: 11,
  moved: 0,
  toLearning: 0,
  toNews: 0,
  unsure: 0,
  promos: 0,
  pulledBack: 0,
  ...o,
});

const response = (proposals: TuneupProposal[], dismissed = 0): TuneupResponse => ({
  proposals,
  dismissed,
  newsletters: [],
  totals: { stories: 12, moved: 3, toLearning: 3, toNews: 0, unsure: 1, promos: 2, pulledBack: 1 },
});

describe("what the page says (#159)", () => {
  it("names the rule and why, in numbers", () => {
    expect(ruleLine(proposal())).toBe("Always Learning");
    expect(whyRule(proposal())).toBe(
      "You moved 3 stories to Learning that Jev put on News, and none the other way.",
    );
    expect(whyRule(proposal({ shelf: "news", fixes: 1 }))).toBe(
      "You moved 1 story to News that Jev put on Learning, and none the other way.",
    );
  });

  it("says what the rule would do over the newsletter's stories", () => {
    expect(replayLine(proposal())).toBe(
      "11 of 12 stories on Learning now · would move 1 more from News",
    );
    expect(replayLine(proposal({ moves: 0, onShelf: 12 }))).toBe(
      "12 of 12 stories on Learning now · moves nothing else",
    );
  });

  it("counts moves against Jev and promos pulled back, leaving out what is none", () => {
    expect(movesLine(row({ moved: 4, toLearning: 2, toNews: 1, unsure: 2 }))).toBe(
      "4 moved · 2 to Learning, 1 to News against Jev · 2 Jev was unsure of",
    );
    expect(movesLine(row({ moved: 2 }))).toBe("2 moved · all as Jev had them");
    expect(movesLine(row())).toBeUndefined();
    expect(promosLine(row({ promos: 3, pulledBack: 2 }))).toBe("3 promos archived · 2 pulled back");
    expect(promosLine(row({ promos: 1 }))).toBe("1 promo archived · 0 pulled back");
    expect(promosLine(row())).toBeUndefined();
    expect(corrections(response([]).totals)).toBe(4);
  });
});

describe("the tune-up store (#159)", () => {
  it("applies a rule as the newsletter's setting, taking it off at once", async () => {
    const p = proposal();
    const api = {
      tuneup: vi.fn(async () => response([p])),
      updateSender: vi.fn(async () => ({})),
    } as unknown as LibraryApi;
    await readTuneup(api);
    expect(waitingCount(tuneupState())).toBe(1);
    const applying = applyProposal(api, p);
    expect(waitingCount(tuneupState())).toBe(0);
    await applying;
    expect(api.updateSender).toHaveBeenCalledWith("sA", { shelf: "learning" });
    // Then read again, since the newsletter's stories moved.
    expect(api.tuneup).toHaveBeenCalledTimes(2);
  });

  it("puts it back when the API says no", async () => {
    const p = proposal();
    const api = {
      tuneup: vi.fn(async () => response([p])),
      updateSender: vi.fn(async () => {
        throw new Error("no");
      }),
      dismissTuneup: vi.fn(async () => {
        throw new Error("no");
      }),
    } as unknown as LibraryApi;
    await readTuneup(api);
    await expect(applyProposal(api, p)).rejects.toThrow("no");
    expect(waitingCount(tuneupState())).toBe(1);
    await expect(dismissProposal(api, p)).rejects.toThrow("no");
    const s = tuneupState();
    expect(s.status === "ok" && s.data).toMatchObject({ proposals: [p], dismissed: 0 });
  });

  it("puts a rule off with Not now and shows the tune-up the API answers with", async () => {
    const p = proposal();
    const api = {
      tuneup: vi.fn(async () => response([p])),
      dismissTuneup: vi.fn(async () => response([], 1)),
    } as unknown as LibraryApi;
    await readTuneup(api);
    const putting = dismissProposal(api, p);
    const s = tuneupState();
    expect(s.status === "ok" && s.data).toMatchObject({ proposals: [], dismissed: 1 });
    await putting;
    expect(api.dismissTuneup).toHaveBeenCalledWith("sA.learning");
  });
});
