import { describe, expect, it, vi } from "vitest";
import type { Prediction } from "@library/core/types";
import type { LibraryApi } from "../src/api.js";
import { recordLine } from "../src/pages/predictions.js";
import { predictionsState, readPredictions, setVerdict } from "../src/predictions.js";

const p = (id: string, over: Partial<Prediction> = {}): Prediction => ({
  id,
  issueId: id.split(".")[0]!,
  senderId: "s1",
  publication: "Pub",
  saidAt: "2026-09-01T08:00:00.000Z",
  text: `Prediction ${id}.`,
  who: "Someone",
  own: false,
  quote: "words",
  by: "2026-12",
  due: "2026-12-31",
  status: "open",
  ...over,
});

describe("recordLine", () => {
  it("says what a newsletter's own calls came to, leaving out what is none", () => {
    expect(recordLine({ right: 3, wrong: 1, unclear: 0, open: 2 })).toBe(
      "3 right · 1 wrong · 2 open",
    );
    expect(recordLine({ right: 0, wrong: 0, unclear: 1, open: 0 })).toBe("1 unclear");
  });
});

describe("the predictions store (#141)", () => {
  it("moves a prediction between Open and Settled as Sandip sets or hands back its verdict", async () => {
    const open = p("a.1");
    const settled = p("b.1", { status: "right", settledAt: "2026-10-27T00:00:00.000Z" });
    const api = {
      predictions: vi.fn(async (view: string) =>
        view === "open" ? { items: [open], due: 0 } : { items: [settled], due: 0 },
      ),
      setVerdict: vi.fn(async (id: string, verdict: Prediction["status"] | null) =>
        verdict
          ? p(id, { status: verdict, setBy: "sandip", settledAt: "2026-10-28T00:00:00.000Z" })
          : p(id),
      ),
    } as unknown as LibraryApi;
    await readPredictions(api, "open");
    await readPredictions(api, "settled");

    await setVerdict(api, open, "wrong");
    const ids = (view: "open" | "settled") => {
      const s = predictionsState(view);
      return s.status === "ok" ? s.data.items.map((i) => i.id) : [];
    };
    expect(ids("open")).toEqual([]);
    expect(ids("settled")).toEqual(["a.1", "b.1"]);

    await setVerdict(api, p("a.1", { status: "wrong", setBy: "sandip" }), null);
    expect(ids("open")).toEqual(["a.1"]);
    expect(ids("settled")).toEqual(["b.1"]);
  });
});
