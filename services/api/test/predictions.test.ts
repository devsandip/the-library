import { DEFAULT_SETTINGS } from "@library/core/settings";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/errors.js";
import {
  predictionView,
  Predictions,
  shown,
  type PredictionStore,
  type Verdict,
} from "../src/predictions.js";
import type { StoredPrediction } from "../src/settle.js";

const p = (id: string, over: Partial<StoredPrediction> = {}): StoredPrediction => ({
  id,
  issueId: id.split(".")[0]!,
  senderId: "s1",
  publication: "Pub",
  saidAt: "2026-09-01T08:00:00.000Z",
  text: `Prediction ${id}.`,
  who: "Someone",
  own: false,
  quote: `prediction ${id} words`,
  by: "2026-12",
  due: "2026-12-31",
  status: "open",
  ...over,
});

describe("predictionView", () => {
  const list = [
    p("b.1", { due: "2027-03-31" }),
    p("a.1", { due: "2026-10-01" }),
    p("c.1", { status: "right", settledAt: "2026-10-20T00:00:00.000Z", tries: 1 }),
    p("d.1", {
      status: "unclear",
      settledAt: "2026-10-25T00:00:00.000Z",
      tries: 1,
      nextTry: "2026-11-08",
    }),
  ];

  it("lists open ones by due date, and counts those due today", () => {
    const v = predictionView(list, "open", "2026-10-28");
    expect(v.items.map((i) => i.id)).toEqual(["a.1", "b.1"]);
    expect(v.due).toBe(1);
  });

  it("lists settled ones latest first, without settling's bookkeeping", () => {
    const v = predictionView(list, "settled", "2026-10-28");
    expect(v.items.map((i) => i.id)).toEqual(["d.1", "c.1"]);
    expect(v.items[0]).not.toHaveProperty("tries");
    expect(v.items[0]).not.toHaveProperty("nextTry");
    expect(shown(list[3]!)).toMatchObject({ id: "d.1", status: "unclear" });
  });
});

describe("Predictions", () => {
  it("sets Sandip's verdict, hands one back with null, and 404s an unknown one", async () => {
    const store: PredictionStore = {
      settings: vi.fn(async () => DEFAULT_SETTINGS),
      listPredictions: vi.fn(async () => []),
      setPredictionVerdict: vi.fn(async (id: string, verdict: Verdict) =>
        id === "a.1"
          ? p("a.1", verdict ? { status: verdict, setBy: "sandip" } : { status: "open" })
          : undefined,
      ),
    };
    const predictions = new Predictions(store, () => Date.parse("2026-10-28T05:00:00.000Z"));
    expect(await predictions.set("a.1", "wrong")).toMatchObject({
      status: "wrong",
      setBy: "sandip",
    });
    expect(store.setPredictionVerdict).toHaveBeenCalledWith(
      "a.1",
      "wrong",
      "2026-10-28T05:00:00.000Z",
    );
    expect(await predictions.set("a.1", null)).toMatchObject({ status: "open" });
    await expect(predictions.set("z.1", "right")).rejects.toBeInstanceOf(HttpError);
  });
});
