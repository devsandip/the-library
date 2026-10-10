/**
 * In-memory backend for local UI work (VITE_MOCK=1 pnpm --filter @library/web dev).
 * Loaded with a dynamic import, so production bundles never include it.
 */
import type {
  DigestStats,
  IssueDetailResponse,
  IssueListItem,
  IssueListResponse,
  Rating,
  ReaderState,
  RelatedResponse,
  SenderDetailResponse,
  SenderListItem,
  SenderListResponse,
  SenderPatch,
  Shelf,
  StatusResponse,
  SummaryResponse,
  Topic,
  TopicListResponse,
  UnreadCount,
  UnreadCountsResponse,
  View,
} from "@library/core/types";
import type { LibraryApi, ListIssuesOptions } from "./api.js";

const HOUR = 3_600_000;
const now = Date.now();

/** [publication, Must Read] */
const SENDERS: [string, boolean][] = [
  ["The Ken", true],
  ["ByteByteGo", true],
  ["System Design Newsletter", true],
  ["Lenny's Newsletter", true],
  ["The Pragmatic Engineer", true],
  ["Business Insider", true],
  ["Platformer", true],
  ["Product Talk", true],
  ["System Design Roadmap", false],
  ["Fortune 500 Digest", false],
  ["TLDR Dev", false],
  ["The Juggernaut", false],
  ["Pirate Wires Daily", false],
  ["WSJ What's News", false],
  ["TLDR Data", false],
  ["The Verge", false],
  ["Example Weekly", false],
];

const senders: SenderListItem[] = SENDERS.map(([publication, mustRead], i) => {
  const senderId = `s${String(i + 1).padStart(12, "0")}`;
  return {
    senderId,
    senderKey: `${publication.toLowerCase().replace(/[^a-z]+/g, "")}@example.test`,
    publication,
    muted: false,
    mustRead,
    up: 0,
    down: 0,
    issueCount: 0,
    lastSeenAt: new Date(now).toISOString(),
    unsubscribeUrl: `https://example.test/unsubscribe/${senderId}`,
  };
});

const topics: Topic[] = [
  "AI & LLMs",
  "AI Infrastructure",
  "Product Management",
  "System Design",
  "Software Engineering",
  "Startups & Business",
  "Tech Industry",
  "Data & Analytics",
  "General Interest",
].map((name) => ({ name, description: `Issues about ${name.toLowerCase()}` }));

/** [publication, shelf, topic, subject, summary, hours ago, minutes, state] */
type Row = [
  string,
  Shelf | null,
  string | null,
  string,
  string | null,
  number,
  number,
  ReaderState,
];
const ROWS: Row[] = [
  [
    "The Ken",
    "news",
    "Startups & Business",
    "How do we fix how India sells insurance?",
    "Why India's insurance market rewards the people who sell policies over the people who buy them, and what a fix would take.",
    2,
    6,
    "unread",
  ],
  [
    "Platformer",
    "news",
    "AI & LLMs",
    "Does intelligence need a hard cap?",
    "The case for and against capping how capable frontier models may get, and who could enforce it.",
    5,
    9,
    "unread",
  ],
  [
    "Business Insider",
    "news",
    "AI & LLMs",
    "Meta wanted to train AI on employee data",
    "Meta's plan to train models on internal work chats, and the pushback from staff.",
    7,
    2,
    "unread",
  ],
  [
    "TLDR Dev",
    "news",
    "AI & LLMs",
    "Gemini 4 Argon, gRPC vs REST, securing agents",
    "Google ships Gemini 4 Argon; when gRPC beats REST; three ways to keep coding agents in bounds.",
    6,
    5,
    "unread",
  ],
  [
    "Fortune 500 Digest",
    "news",
    "AI Infrastructure",
    "Nscale files for a $35 billion IPO",
    "An AI data-centre builder goes public despite losses; Bitcoin rallies on rate news.",
    8,
    7,
    "unread",
  ],
  [
    "WSJ What's News",
    "news",
    "Startups & Business",
    "The Fed is set to raise rates",
    "A first rate rise in years looks likely; a pipeline shutdown lifts oil prices.",
    9,
    5,
    "unread",
  ],
  [
    "Pirate Wires Daily",
    "news",
    "Tech Industry",
    "Three morning takes",
    "Takes on AI regulation, the defence-tech boom and a founder feud.",
    10,
    4,
    "unread",
  ],
  [
    "The Verge",
    "news",
    "Tech Industry",
    "Inside the sudden boom in AI safety",
    "Why AI safety went from niche research to a crowded, well-funded field this year.",
    26,
    6,
    "unread",
  ],
  ["Example Weekly", null, null, "Images from everywhere", null, 30, 3, "unread"],
  [
    "ByteByteGo",
    "learning",
    "System Design",
    "How Netflix taught an LLM to recommend movies",
    "How Netflix tuned a language model on viewing history to rank what you see next.",
    25,
    12,
    "unread",
  ],
  [
    "System Design Newsletter",
    "learning",
    "System Design",
    "How vector databases search billions of vectors in milliseconds",
    "Approximate nearest-neighbour search, HNSW graphs and quantisation, step by step.",
    49,
    10,
    "unread",
  ],
  [
    "Lenny's Newsletter",
    "learning",
    "Product Management",
    "Inside Gemini: how Google runs product for its model",
    "How the Gemini team plans, ships and measures a model as a product.",
    73,
    14,
    "unread",
  ],
  [
    "The Pragmatic Engineer",
    "learning",
    "Software Engineering",
    "Building resilient systems with Sam Newman",
    "Timeouts, retries and bulkheads: resilience patterns that hold up in production.",
    50,
    16,
    "unread",
  ],
  [
    "Product Talk",
    "learning",
    "Product Management",
    "Testing assumptions",
    "Turning risky assumptions into small, fast tests before anyone writes code.",
    120,
    8,
    "unread",
  ],
  [
    "System Design Roadmap",
    "learning",
    "System Design",
    "Design an API gateway: a walkthrough",
    "Routing, auth and rate limiting for an API gateway, designed one decision at a time.",
    97,
    6,
    "unread",
  ],
  [
    "TLDR Data",
    "learning",
    "Data & Analytics",
    "Postgres at 118 million queries a second",
    "How one team scaled Postgres reads with sharding and connection pooling.",
    75,
    5,
    "unread",
  ],
  [
    "The Juggernaut",
    "learning",
    "General Interest",
    "How snakes and ladders lost its soul",
    "The board game began as an Indian lesson in karma before it became a children's race.",
    145,
    7,
    "unread",
  ],
  [
    "The Verge",
    "news",
    "Tech Industry",
    "The week's best phones, ranked",
    "A quick ranking of this year's phones by camera, battery and price.",
    60,
    4,
    "read",
  ],
  [
    "TLDR Dev",
    "news",
    "Software Engineering",
    "Bun 2, Deno's comeback and a faster Git",
    "Bun 2 lands; Deno courts enterprises; a Git change makes big clones quicker.",
    54,
    5,
    "read",
  ],
  [
    "ByteByteGo",
    "learning",
    "System Design",
    "Consistent hashing, explained with one diagram",
    "Why consistent hashing keeps caches stable when servers come and go.",
    170,
    9,
    "read",
  ],
  [
    "Fortune 500 Digest",
    "news",
    "Startups & Business",
    "Ten deals that defined the quarter",
    "The quarter's biggest mergers and what each one says about the market.",
    200,
    6,
    "archived",
  ],
];

/** Offline placeholder image, so mock mode makes no network requests. */
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#d9d4c7"/><path d="M0 480 L300 300 L520 420 L800 220 L1200 460 V600 H0Z" fill="#b8b09c"/></svg>',
  );

const issues: (IssueListItem & { html: string })[] = ROWS.map(
  ([publication, shelf, topic, subject, summary, hours, minutes, state], i) => {
    const s = senders.find((x) => x.publication === publication)!;
    s.issueCount++;
    return {
      id: `mock-${i + 1}`,
      senderId: s.senderId,
      publication,
      subject,
      snippet:
        "A short preview line from the top of the issue, the way Gmail shows it in the inbox list.",
      receivedAt: new Date(now - hours * HOUR).toISOString(),
      readMinutes: minutes,
      state,
      viewOnlineUrl: `https://example.test/p/${i + 1}`,
      ...(shelf ? { shelf } : {}),
      ...(topic ? { topic } : {}),
      ...(summary ? { summary } : {}),
      html: sampleHtml(subject, publication),
    };
  },
);

function sampleHtml(subject: string, publication: string): string {
  return `<table width="600" align="center" style="font-family:Georgia,serif;color:#222"><tr><td>
<p style="font-size:12px;color:#888">${publication}</p>
<h1 style="font-size:28px;line-height:1.2">${subject}</h1>
<p>Newsletters arrive as 600 pixel wide tables like this one. The reader frame makes them fit a phone screen without breaking the layout.</p>
<img src="${PLACEHOLDER_IMAGE}" width="600" alt="illustration">
<p>${"This is placeholder body text for local development. ".repeat(12)}</p>
<p><a href="https://example.test/read-more">Read the full post</a></p>
</td></tr></table>`;
}

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const statesFor: Record<View, ReaderState[]> = {
  unread: ["unread"],
  all: ["unread", "read"],
  archived: ["archived"],
};
const strip = ({ html: _html, ...item }: IssueListItem & { html: string }): IssueListItem => item;
const mustSet = () => new Set(senders.filter((s) => s.mustRead).map((s) => s.senderId));
const withStar = (i: IssueListItem): IssueListItem =>
  mustSet().has(i.senderId) ? { ...i, mustRead: true } : i;

function find(id: string) {
  const issue = issues.find((i) => i.id === id);
  if (!issue) throw new Error("issue not found");
  return issue;
}

/** Today's top 5 as first shown, like the API's digest log. */
let mockDigest: string[] | undefined;

/** A stand-in for the success measure: three earlier days, plus today's digest as rated so far. */
function digestStats(): DigestStats {
  const today = issues.filter((i) => mockDigest?.includes(i.id));
  return {
    days: 3 + (mockDigest ? 1 : 0),
    shown: 15 + today.length,
    relevant: 7 + today.filter((i) => i.rating === 1).length,
    irrelevant: 3 + today.filter((i) => i.rating === -1).length,
  };
}

export class MockLibraryApi implements LibraryApi {
  async listIssues(opts: ListIssuesOptions): Promise<IssueListResponse> {
    await delay();
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const must = mustSet();
    const picked = opts.senders?.length ? new Set(opts.senders) : undefined;
    const matching = issues
      .filter(
        (i) =>
          statesFor[opts.view].includes(i.state) &&
          (picked ? picked.has(i.senderId) : opts.view === "archived" || !muted.has(i.senderId)) &&
          (!opts.shelf || (i.shelf ?? "news") === opts.shelf) &&
          (!opts.topics?.length || (i.topic !== undefined && opts.topics.includes(i.topic))),
      )
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    // Unread lists Must Read newsletters first, like the API.
    const all =
      opts.view === "unread" && !picked
        ? [
            ...matching.filter((i) => must.has(i.senderId)),
            ...matching.filter((i) => !must.has(i.senderId)),
          ]
        : matching;
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const limit = opts.limit ?? 30;
    const page = all.slice(start, start + limit).map((i) => withStar(strip(i)));
    return { items: page, cursor: start + limit < all.length ? String(start + limit) : undefined };
  }
  async getIssue(id: string): Promise<IssueDetailResponse> {
    await delay();
    const i = find(id);
    return {
      ...withStar(strip(i)),
      html: i.html,
      fromAddr: "hello@example.test",
      unsubscribeUrl: "https://example.test/unsubscribe",
    };
  }
  async setState(id: string, state: ReaderState) {
    await delay(80);
    const i = find(id);
    i.state = state;
    return strip(i);
  }
  async setShelf(id: string, shelf: Shelf) {
    await delay(80);
    const i = find(id);
    i.shelf = shelf;
    return strip(i);
  }
  async listTopics(): Promise<TopicListResponse> {
    await delay();
    return { topics };
  }
  async unreadCounts(): Promise<UnreadCountsResponse> {
    await delay();
    const tally = new Map<string, UnreadCount>();
    for (const i of issues.filter((x) => x.state === "unread")) {
      const key = `${i.senderId}|${i.shelf ?? ""}|${i.topic ?? ""}`;
      const t = tally.get(key);
      if (t) t.n++;
      else tally.set(key, { senderId: i.senderId, shelf: i.shelf, topic: i.topic, n: 1 });
    }
    return { counts: [...tally.values()] };
  }
  async related(id: string): Promise<RelatedResponse> {
    await delay();
    // A stand-in for the API's nearest neighbours: other issues on the same topic.
    const me = issues.find((i) => i.id === id);
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const near = issues
      .filter(
        (i) =>
          me?.topic && i.id !== id && i.topic === me.topic && !i.promo && !muted.has(i.senderId),
      )
      .map((i) => ({ ...strip(i), similarity: 0.3 }));
    const side = (before: boolean) =>
      near.filter((i) => i.receivedAt < me!.receivedAt === before).slice(0, 3);
    return { earlier: side(true), since: side(false) };
  }

  async summary(): Promise<SummaryResponse> {
    await delay();
    // A stand-in for the API's ranking: Must Read and AI topics lift, freshness decays.
    const must = mustSet();
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const news = issues.filter(
      (i) => i.state === "unread" && (i.shelf ?? "news") === "news" && !muted.has(i.senderId),
    );
    const scored = news.map((i) => {
      const fresh = 0.5 ** ((now - Date.parse(i.receivedAt)) / HOUR / 48);
      const sender = must.has(i.senderId) ? 0.75 : 0.5;
      const topic = i.topic?.startsWith("AI") ? 0.8 : 0.5;
      const reason =
        sender > 0.5
          ? "From a Must Read newsletter"
          : topic > 0.5
            ? "Close to your interest in AI"
            : fresh > 0.9
              ? "Just in"
              : "Among the newest";
      return { i, score: 0.4 * sender + 0.4 * topic + 0.2 * fresh, reason };
    });
    scored.sort((a, b) => b.score - a.score);
    return {
      items: scored.slice(0, 20).map((s) => ({ ...withStar(strip(s.i)), scoreReason: s.reason })),
      candidates: news.length,
      digest: (mockDigest ??= scored.slice(0, 5).map((s) => s.i.id)),
      digestStats: digestStats(),
    };
  }
  async rate(id: string, value: Rating | 0) {
    await delay(80);
    const i = find(id);
    const s = senders.find((x) => x.senderId === i.senderId)!;
    if (i.rating === 1) s.up--;
    if (i.rating === -1) s.down--;
    i.rating = value === 0 ? undefined : value;
    if (value === 1) s.up++;
    if (value === -1) s.down++;
    return strip(i);
  }
  async logOpen() {}
  async listSenders(): Promise<SenderListResponse> {
    await delay();
    return { items: [...senders].sort((a, b) => a.publication.localeCompare(b.publication)) };
  }
  async getSender(senderId: string): Promise<SenderDetailResponse> {
    await delay();
    const s = senders.find((x) => x.senderId === senderId);
    if (!s) throw new Error("sender not found");
    return {
      ...s,
      addresses: [s.senderKey],
      issues: issues
        .filter((i) => i.senderId === senderId)
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
        .map(strip),
    };
  }
  async updateSender(senderId: string, patch: SenderPatch) {
    await delay(80);
    const s = senders.find((x) => x.senderId === senderId)!;
    const { shelf, ...flags } = patch;
    Object.assign(s, flags);
    if (shelf) {
      s.shelf = shelf;
      for (const i of issues) if (i.senderId === senderId) i.shelf = shelf;
    } else if (shelf === null) {
      delete s.shelf;
    }
    return { ...s };
  }
  async refreshNow() {
    await delay(400);
  }
  async status(): Promise<StatusResponse> {
    await delay();
    return {
      stage: "mock",
      digestStats: digestStats(),
      lastRunAt: new Date(now - 40 * 60_000).toISOString(),
      lastRunStats: {
        query: "mock",
        listed: 12,
        alreadyStored: 10,
        newsletters: 2,
        filtered: 0,
        errors: 0,
        errorSamples: [],
        durationMs: 1800,
      },
      lastError: null,
      lastStories: {
        checked: 2,
        storied: 2,
        stories: 14,
        linked: 3,
        deferred: 0,
        errors: 0,
        errorSamples: [],
        inputTokens: 9100,
        outputTokens: 1650,
        embedTokens: 900,
        durationMs: 21_000,
      },
    };
  }
}
