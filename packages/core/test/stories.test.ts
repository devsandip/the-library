import { describe, expect, it } from "vitest";
import { eventFor, linkEvents, nameKey, storyRef, type EventCandidate } from "../src/stories.js";

const at = (day: number, hour = 8) =>
  `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

/** A unit vector whose cosine with [1, 0, 0, 0] is `c`, leaning toward `axis`. */
const near = (c: number, axis = 1): number[] => {
  const v = [c, 0, 0, 0];
  v[axis] = Math.sqrt(1 - c * c);
  return v;
};

const story = (
  issueId: string,
  day: number,
  vector: number[],
  names: string[] = [],
  eventId?: string,
): EventCandidate => ({
  key: storyRef(issueId, 1),
  issueId,
  receivedAt: at(day),
  names,
  vector,
  eventId,
});

describe("eventFor", () => {
  const base = story("b", 5, [1, 0, 0, 0], ["OpenAI"]);

  it("joins a very similar story's event", () => {
    const m = eventFor(base, [story("a", 4, near(0.85), [], "a#01")]);
    expect(m.eventId).toBe("a#01");
    expect(m.key).toBe("a#01");
    expect(m.similarity).toBeCloseTo(0.85);
  });

  it("needs a shared name when the stories are only fairly similar", () => {
    expect(eventFor(base, [story("a", 4, near(0.7), ["Google"], "a#01")])).toEqual({
      eventId: "b#01",
    });
    expect(eventFor(base, [story("a", 4, near(0.7), ["The openai"], "a#01")]).eventId).toBe("a#01");
    expect(eventFor(base, [story("a", 4, near(0.5), ["OpenAI"], "a#01")]).eventId).toBe("b#01");
  });

  it("ignores its own issue, stories days away and stories not linked yet", () => {
    const others = [
      story("b", 5, near(0.95), [], "b#07"),
      story("a", 9, near(0.95), [], "a#01"),
      story("c", 4, near(0.95)),
    ];
    expect(eventFor(base, others)).toEqual({ eventId: "b#01" });
  });

  it("takes the most similar of several", () => {
    const others = [
      story("a", 4, near(0.82, 1), [], "x"),
      story("c", 6, near(0.9, 2), [], "y"),
      story("d", 3, near(0.85, 3), [], "z"),
    ];
    expect(eventFor(base, others).eventId).toBe("y");
  });
});

describe("linkEvents", () => {
  it("links in arrival order, whatever order the stories come in", () => {
    const s1 = story("a", 1, [1, 0, 0, 0]);
    const s2 = story("b", 2, near(0.9, 1));
    // Similar to both, but four days after s2: a new event.
    const s3 = story("c", 6, near(0.9, 2));
    const s4 = story("d", 3, [0, 0, 0, 1]);
    const want = new Map([
      ["a#01", "a#01"],
      ["b#01", "a#01"],
      ["c#01", "c#01"],
      ["d#01", "d#01"],
    ]);
    expect(linkEvents([s1, s2, s3, s4])).toEqual(want);
    expect(linkEvents([s4, s3, s2, s1])).toEqual(want);
  });

  it("follows a story that keeps going, a link at a time", () => {
    const chain = [1, 3, 5, 7].map((day, k) => story(`i${k}`, day, near(0.99 - k * 0.001, 1)));
    const ids = linkEvents(chain);
    expect(new Set(ids.values())).toEqual(new Set(["i0#01"]));
  });
});

describe("nameKey", () => {
  it("ignores case, punctuation and a leading The", () => {
    expect(nameKey("The OpenAI")).toBe("openai");
    expect(nameKey("GPT-5")).toBe("gpt 5");
    expect(nameKey(" Sam Altman, ")).toBe("sam altman");
  });
});
