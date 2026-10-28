import { describe, expect, it, vi } from "vitest";
import type { ClaudePort, ToolRequest } from "../src/claude.js";
import { CorpusCache, type CorpusIssue, type CorpusStory } from "../src/corpus.js";
import {
  NOTHING_SINCE,
  parseSettle,
  settleable,
  settleRequest,
  Settler,
  type Settlement,
  type SettleStore,
  type StoredPrediction,
} from "../src/settle.js";

const unit = (...xs: number[]) => {
  const n = Math.hypot(...xs);
  return Float32Array.from(xs.map((x) => x / n));
};
const at = (date: string) => `${date}T08:00:00.000Z`;
const issue = (id: string, senderId: string, date: string): CorpusIssue => ({
  id,
  senderId,
  publication: `Pub ${senderId}`,
  subject: `Subject of ${id}`,
  receivedAt: at(date),
});
const story = (id: string, n: number, headline: string, vector: Float32Array): CorpusStory => ({
  id,
  n,
  headline,
  summary: `What ${headline} says.`,
  names: ["Acme"],
  vector,
});

// Axis 0 is Acme's robot; axis 1 is rates.
const issues = [
  issue("said", "T", "2026-09-01"),
  issue("before", "B", "2026-08-20"),
  issue("shipped", "W", "2026-10-05"),
  issue("muted", "M", "2026-10-06"),
  issue("rates", "R", "2026-10-07"),
];
const stories = [
  story("said", 1, "Acme will ship its robot by October", unit(1, 0)),
  story("before", 1, "Acme teases a robot", unit(1, 0.1)),
  story("shipped", 1, "Acme ships its robot to the first customers", unit(1, 0.05)),
  story("muted", 1, "Acme robot ships, a muted take", unit(1, 0.02)),
  story("rates", 1, "Rates rise again", unit(0, 1)),
];

const prediction = (over: Partial<StoredPrediction> = {}): StoredPrediction => ({
  id: "said.1",
  issueId: "said",
  n: 1,
  senderId: "T",
  publication: "Pub T",
  saidAt: at("2026-09-01"),
  text: "Acme will ship its robot by October 2026.",
  who: "Acme's founder",
  own: false,
  quote: "Acme will ship its robot by October",
  by: "2026-10",
  due: "2026-10-31",
  status: "open",
  ...over,
});

describe("settleable", () => {
  const today = "2026-11-02";
  it("is a due prediction that is open, or unclear and due to be tried again", () => {
    expect(settleable(prediction(), today)).toBe(true);
    expect(settleable(prediction({ due: "2026-11-30" }), today)).toBe(false);
    expect(settleable(prediction({ status: "right" }), today)).toBe(false);
    expect(
      settleable(prediction({ status: "unclear", tries: 1, nextTry: "2026-11-02" }), today),
    ).toBe(true);
    expect(
      settleable(prediction({ status: "unclear", tries: 1, nextTry: "2026-11-10" }), today),
    ).toBe(false);
    expect(settleable(prediction({ status: "unclear", tries: 3 }), today)).toBe(false);
    expect(settleable(prediction({ setBy: "sandip" }), today)).toBe(false);
  });
});

describe("settleRequest and parseSettle", () => {
  const items = [
    {
      id: "1",
      issueId: "shipped",
      n: 1,
      receivedAt: at("2026-10-05"),
      publication: "Pub W",
      headline: "Acme ships its robot",
      summary: "It shipped.",
      names: ["Acme"],
      digest: false,
    },
  ];

  it("sends the prediction, when it was said and due, and the later stories", () => {
    const req = settleRequest(prediction(), items, "2026-11-02");
    expect(req.tool.name).toBe("settle");
    expect(req.user).toContain("Prediction: Acme will ship its robot by October 2026.");
    expect(req.user).toContain("Due: 2026-10-31");
    expect(req.user).toContain("1 | 2026-10-05 | Pub W | Acme ships its robot. It shipped.");
    expect(req.system).toContain("Silence is unclear, not wrong");
    expect(req.system).toContain("did not happen by 1 October");
  });

  it("keeps a verdict with its stories, and makes one without known stories unclear", () => {
    expect(
      parseSettle({ verdict: "right", why: "It shipped on 5 October.", stories: ["1"] }, items),
    ).toEqual({
      status: "right",
      why: "It shipped on 5 October.",
      evidence: [
        {
          issueId: "shipped",
          n: 1,
          publication: "Pub W",
          headline: "Acme ships its robot",
          receivedAt: at("2026-10-05"),
        },
      ],
    });
    expect(parseSettle({ verdict: "wrong", why: "Delayed.", stories: ["9"] }, items)).toEqual({
      status: "unclear",
      why: "Delayed.",
      evidence: [],
    });
    expect(parseSettle({ verdict: "maybe" }, items)).toEqual({
      status: "unclear",
      why: NOTHING_SINCE,
      evidence: [],
    });
  });
});

describe("Settler", () => {
  function setup(list: StoredPrediction[], answer: unknown) {
    const settled = new Map<string, Settlement>();
    const store: SettleStore = {
      listPredictions: vi.fn(async () => list),
      settlePrediction: vi.fn(async (id: string, s: Settlement) => void settled.set(id, s)),
      listSenders: vi.fn(async () => [
        {
          senderId: "M",
          senderKey: "m",
          publication: "Pub M",
          muted: true,
          mustRead: false,
          issueCount: 1,
          up: 0,
          down: 0,
        },
      ]),
    } as unknown as SettleStore;
    const calls: ToolRequest[] = [];
    const claude: ClaudePort = {
      callTool: vi.fn(async (req: ToolRequest) => {
        calls.push(req);
        return { input: answer, inputTokens: 1200, outputTokens: 80 };
      }),
    };
    // The prediction's own words, as an embedding: close to axis 0.
    const embedder = { embed: vi.fn(async () => unit(1, 0.01)) };
    const settler = new Settler(
      store,
      new CorpusCache({ readCorpus: async () => ({ issues, stories }) }),
      embedder,
      claude,
      "haiku",
      () => Date.parse("2026-11-02T04:00:00.000Z"),
    );
    return { settler, settled, calls, store };
  }

  it("settles a due prediction from later stories, never its own issue, earlier ones or muted ones", async () => {
    const { settler, settled, calls } = setup([prediction()], {
      verdict: "right",
      why: "Acme shipped its robot on 5 October.",
      stories: ["1"],
    });
    const stats = await settler.settleDue();
    expect(stats).toMatchObject({ due: 1, right: 1, wrong: 0, unclear: 0, errors: 0 });
    expect(calls[0]!.user).toContain("Acme ships its robot to the first customers");
    expect(calls[0]!.user).not.toContain("Acme teases a robot");
    expect(calls[0]!.user).not.toContain("a muted take");
    expect(calls[0]!.user).not.toContain("Acme will ship its robot by October |");
    expect(settled.get("said.1")).toMatchObject({
      status: "right",
      tries: 1,
      evidence: [{ issueId: "shipped", n: 1 }],
      model: "haiku",
    });
    expect(settled.get("said.1")!.nextTry).toBeUndefined();
  });

  it("tries an unclear one again in a fortnight, and not after the third try", async () => {
    const unclear = { verdict: "unclear", why: "Nothing says it shipped.", stories: [] };
    const first = setup([prediction()], unclear);
    await first.settler.settleDue();
    expect(first.settled.get("said.1")).toMatchObject({
      status: "unclear",
      tries: 1,
      nextTry: "2026-11-16",
    });

    const last = setup(
      [prediction({ status: "unclear", tries: 2, nextTry: "2026-11-01" })],
      unclear,
    );
    await last.settler.settleDue();
    expect(last.settled.get("said.1")).toMatchObject({ status: "unclear", tries: 3 });
    expect(last.settled.get("said.1")!.nextTry).toBeUndefined();
  });

  it("makes no call when nothing since mentions it, and leaves Sandip's verdicts alone", async () => {
    const lonely = prediction({
      id: "said.2",
      text: "Rates fall to zero.",
      saidAt: at("2026-10-20"),
    });
    const { settler, settled, calls } = setup(
      [lonely, prediction({ id: "said.1", setBy: "sandip", status: "wrong" })],
      {},
    );
    const stats = await settler.settleDue();
    expect(calls).toHaveLength(0);
    expect(stats).toMatchObject({ due: 1, unclear: 1, nothingFound: 1 });
    expect(settled.get("said.2")).toMatchObject({ status: "unclear", why: NOTHING_SINCE });
    expect(settled.has("said.1")).toBe(false);
  });

  it("settles at most the day's limit, oldest due first", async () => {
    const list = [
      prediction({ id: "said.3", due: "2026-10-30" }),
      prediction({ id: "said.4", due: "2026-10-01" }),
    ];
    const { settler, settled } = setup(list, { verdict: "right", why: "Shipped.", stories: ["1"] });
    const stats = await settler.settleDue(1);
    expect([...settled.keys()]).toEqual(["said.4"]);
    expect(stats).toMatchObject({ due: 2, later: 1 });
  });
});
