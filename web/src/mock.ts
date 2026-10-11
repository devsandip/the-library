/**
 * In-memory backend for local UI work (VITE_MOCK=1 pnpm --filter @library/web dev).
 * Loaded with a dynamic import, so production bundles never include it.
 */
import { readerDay } from "@library/core/days";
import { issueDoc, queryTerms, rankByWords, storyDoc } from "@library/core/search";
import type {
  DigestStats,
  HistoryResponse,
  IssueDetailResponse,
  IssueListItem,
  IssueListResponse,
  IssueStoriesResponse,
  Narrative,
  NowReadingResponse,
  Rating,
  ReaderState,
  RelatedResponse,
  SearchHit,
  SearchResponse,
  SearchSort,
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
  ["TLDR AI", false],
  ["TLDR", false],
  ["The Batch", false],
  ["Inc42", false],
  ["Exponential View", false],
  ["Stratechery", false],
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
  // More News, so the Today deck and the five have a day's worth (the redesign).
  [
    "TLDR AI",
    "news",
    "AI & LLMs",
    "OpenAI agents book travel, Mistral goes small",
    "OpenAI opens booking agents to all paid users; Mistral releases a 3B model that runs on phones; Apple lets its on-device model call apps; an eval startup raises $60M as labs buy in; Google brings deep research to Workspace.",
    3,
    5,
    "unread",
  ],
  [
    "TLDR",
    "news",
    "Tech Industry",
    "Meta's display glasses, Uber's robotaxi pilot",
    "Meta's display glasses go on sale; Uber starts a robotaxi pilot in two cities; Figma turns prompts into slide decks; Stripe adds stablecoin payouts.",
    7,
    5,
    "unread",
  ],
  [
    "The Batch",
    "news",
    "AI & LLMs",
    "Small models, big margins",
    "Why labs are racing to ship 1 to 4B models: cheaper inference and on-device privacy.",
    24,
    6,
    "unread",
  ],
  [
    "Inc42",
    "news",
    "Startups & Business",
    "Quick commerce's quiet consolidation",
    "Two of India's quick-commerce apps are merging dark stores as the discounts dry up.",
    9,
    5,
    "unread",
  ],
  [
    "Exponential View",
    "news",
    "Tech Industry",
    "The price of a token, falling",
    "Token prices fell tenfold in a year. What that does to the margins of software built on them.",
    22,
    8,
    "unread",
  ],
  [
    "Platformer",
    "news",
    "AI & LLMs",
    "The agents are here, and they're bad at checkout",
    "A week with the new booking agents: good at planning a trip, still stuck at payment pages and airline logins.",
    2,
    9,
    "unread",
  ],
  [
    "The Ken",
    "news",
    "Startups & Business",
    "Zepto's IPO math",
    "Zepto's draft filing shows dark stores in profit in nine cities. The Ken asks whether that lasts once the discounts stop.",
    5,
    11,
    "unread",
  ],
  [
    "Stratechery",
    "news",
    "Tech Industry",
    "Aggregators and agents",
    "If agents do the shopping, who owns the customer? A look at what changes for the aggregators.",
    12,
    14,
    "unread",
  ],
];

/** Offline placeholder image, so mock mode makes no network requests. */
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#d9d4c7"/><path d="M0 480 L300 300 L520 420 L800 220 L1200 460 V600 H0Z" fill="#b8b09c"/></svg>',
  );

const issues: (IssueListItem & { html: string; ratedAt?: string })[] = ROWS.map(
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

/** A few screens long, in numbered parts, so the place in an issue (#44) can be seen. */
function sampleHtml(subject: string, publication: string): string {
  const parts = [1, 2, 3, 4, 5, 6]
    .map(
      (n) => `<h2 style="font-size:20px">Part ${n}</h2>
<p>${`This is placeholder body text for part ${n}, for local development. `.repeat(10)}</p>
${n % 2 ? `<img src="${PLACEHOLDER_IMAGE}" width="600" alt="illustration ${n}">` : ""}`,
    )
    .join("\n");
  return `<table width="600" align="center" style="font-family:Georgia,serif;color:#222"><tr><td>
<p style="font-size:12px;color:#888">${publication}</p>
<h1 style="font-size:28px;line-height:1.2">${subject}</h1>
<p>Newsletters arrive as 600 pixel wide tables like this one. The reader frame makes them fit a phone screen without breaking the layout.</p>
${parts}
<p><a href="https://example.test/read-more">Read the full post</a></p>
<p style="font-size:12px;color:#888">You are reading ${publication}. Unsubscribe any time.</p>
</td></tr></table>`;
}

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const statesFor: Record<View, ReaderState[]> = {
  unread: ["unread"],
  all: ["unread", "read"],
  archived: ["archived"],
  saved: ["unread", "read"],
};
const strip = ({
  html: _html,
  ratedAt: _ratedAt,
  ...item
}: IssueListItem & { html: string; ratedAt?: string }): IssueListItem => item;
const mustSet = () => new Set(senders.filter((s) => s.mustRead).map((s) => s.senderId));
const withStar = (i: IssueListItem): IssueListItem =>
  mustSet().has(i.senderId) ? { ...i, mustRead: true } : i;

function find(id: string) {
  const issue = issues.find((i) => i.id === id);
  if (!issue) throw new Error("issue not found");
  return issue;
}

// Two issues start saved (#43): one read, one not.
for (const [id, hours] of [
  ["mock-6", 5],
  ["mock-9", 26],
] as const) {
  const i = issues.find((x) => x.id === id);
  if (i && i.state !== "archived") i.savedAt = new Date(now - hours * HOUR).toISOString();
}

/** Today's top 5 as first shown, like the API's digest log, and when. */
let mockDigest: string[] | undefined;
let mockDigestAt: string | undefined;

/** Now reading (#44): starts a third of the way into an issue, as if read on another device. */
let mockPlace: { issueId: string; position: number; since: string; at: string } | undefined = {
  issueId: "mock-3",
  position: 0.35,
  since: new Date(now - 3 * HOUR).toISOString(),
  at: new Date(now - 2 * HOUR).toISOString(),
};

/** The API's rules: hidden once finished, archived, or rated after it was opened. */
function mockNowReading(): NowReadingResponse {
  if (!mockPlace || mockPlace.position >= 1) return {};
  const i = issues.find((x) => x.id === mockPlace!.issueId);
  if (!i || i.state === "archived" || (i.rating && i.ratedAt! >= mockPlace.since)) return {};
  return { nowReading: { issue: strip(i), position: mockPlace.position, at: mockPlace.at } };
}

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

/**
 * A stand-in for read history (#42): four issues opened on each of today, yesterday and three
 * days ago, so previous and next skip the empty day between. Opens after now are not shown yet.
 */
function mockHistory(day: string): HistoryResponse {
  const days = [0, 1, 3].map((k) => readerDay(now - k * 24 * HOUR));
  const opens = days
    .flatMap((d, k) =>
      issues.slice(k * 4, k * 4 + 4).map((issue, n) => ({
        day: d,
        issue,
        at: new Date(`${d}T${String(8 + n * 3).padStart(2, "0")}:15:00+05:30`).toISOString(),
      })),
    )
    .filter((o) => Date.parse(o.at) <= now);
  const withReads = [...new Set(opens.map((o) => o.day))].sort();
  const earlier = withReads.filter((d) => d < day).pop();
  const later = withReads.find((d) => d > day);
  return {
    day,
    items: opens
      .filter((o) => o.day === day)
      // Every third read a peek left open (#56), as History tells them apart.
      .map((o, n) => ({
        ...withStar(strip(o.issue)),
        openedAt: o.at,
        via: n % 3 === 2 ? ("peek" as const) : ("open" as const),
      }))
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    ...(earlier ? { previousDay: earlier } : {}),
    ...(later ? { nextDay: later } : {}),
  };
}

/** A stand-in for the day in brief (#18): sample threads citing the top News issues. */
function mockNarrative(top: IssueListItem[]): Narrative | undefined {
  if (top.length < 4) return undefined;
  const from = (...n: number[]) =>
    n.map((k) => ({ issueId: top[k]!.id, publication: top[k]!.publication }));
  return {
    at: new Date(now - 2 * HOUR).toISOString(),
    stories: 42,
    newsletters: 7,
    threads: [
      {
        title: "Cheaper small models reach the enterprise",
        text:
          "Two labs released small models priced for high-volume work, and a cloud provider cut " +
          "its per-token rates by a third the same day. Together they make routine agent work " +
          "cheaper for teams already paying for larger models.",
        sources: from(0, 2),
      },
      {
        title: "App stores set rules for AI agents",
        text:
          "An app store now requires apps to say when an agent acts for the user. Two developer " +
          "newsletters walked through what changes for apps that book, buy or message on a " +
          "user's behalf.",
        sources: from(1),
      },
      {
        title: "Chip demand keeps suppliers stretched",
        text:
          "A foundry reported another record month on AI chip orders, and a memory maker said " +
          "its supply is sold out through next year.",
        sources: from(3),
      },
    ],
  };
}

/**
 * A stand-in for the story index (#15): a digest's subject or Claude's line lists its stories with
 * semicolons, so each part is a story; anything else is one story. Promos have none, as in the API.
 */
function mockStories(i: IssueListItem): IssueStoriesResponse {
  if (i.promo) return { stories: [] };
  const listed = [i.subject, i.summary ?? ""].find((t) => t.includes(";")) ?? i.subject;
  const parts = listed
    .split(";")
    .map((p) => p.trim().replace(/\.$/, ""))
    .filter(Boolean);
  return {
    stories: parts.map((part, k) => ({
      n: k + 1,
      headline: part.charAt(0).toUpperCase() + part.slice(1),
      summary:
        parts.length > 1
          ? `What ${i.publication} says about this, in a sentence or two, with the source linked.`
          : (i.summary ?? i.snippet) +
            " A second sentence from the story index says a little more than the line above.",
      ...(parts.length > 1 ? { link: `https://example.test/${i.id}/story-${k + 1}` } : {}),
      ...namesIn(part),
    })),
  };
}

/** A stand-in for the story index's names: the capitalised words after the first. */
function namesIn(text: string): { names?: string[] } {
  const names = [...new Set(text.split(/\s+/).slice(1))]
    .map((w) => w.replace(/[^\p{L}\p{N}]+$/u, "").replace(/'s$/, ""))
    .filter((w) => /^\p{Lu}/u.test(w) && w.length > 2)
    .slice(0, 3);
  return names.length ? { names } : {};
}

export class MockLibraryApi implements LibraryApi {
  async listIssues(opts: ListIssuesOptions): Promise<IssueListResponse> {
    await delay();
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const must = mustSet();
    const picked = opts.senders?.length ? new Set(opts.senders) : undefined;
    // Saved (#43) is its own queue, newest saved first: saved issues leave Unread, and hide no one.
    const saved = opts.view === "saved";
    const matching = issues
      .filter(
        (i) =>
          statesFor[opts.view].includes(i.state) &&
          (saved ? i.savedAt !== undefined : opts.view !== "unread" || i.savedAt === undefined) &&
          (picked
            ? picked.has(i.senderId)
            : opts.view === "archived" || saved || !muted.has(i.senderId)) &&
          (!opts.shelf || (i.shelf ?? "news") === opts.shelf) &&
          (!opts.topics?.length || (i.topic !== undefined && opts.topics.includes(i.topic))),
      )
      .sort((a, b) =>
        saved ? b.savedAt!.localeCompare(a.savedAt!) : b.receivedAt.localeCompare(a.receivedAt),
      );
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
    const position = mockPlace?.issueId === id ? mockPlace.position : 0;
    return {
      ...withStar(strip(i)),
      html: i.html,
      fromAddr: "hello@example.test",
      unsubscribeUrl: "https://example.test/unsubscribe",
      ...(position > 0 && position < 1 ? { position } : {}),
    };
  }
  async setState(id: string, state: ReaderState) {
    await delay(80);
    const i = find(id);
    i.state = state;
    // Archiving takes an issue off the Saved list (#43).
    if (state === "archived") delete i.savedAt;
    return strip(i);
  }
  async setSaved(id: string, saved: boolean) {
    await delay(80);
    const i = find(id);
    if (saved && i.state === "archived") throw new Error("archived issues cannot be saved");
    if (!saved) delete i.savedAt;
    else i.savedAt ??= new Date().toISOString();
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
    for (const i of issues.filter((x) => x.state === "unread" && x.savedAt === undefined)) {
      const key = `${i.senderId}|${i.shelf ?? ""}|${i.topic ?? ""}`;
      const t = tally.get(key);
      if (t) t.n++;
      else tally.set(key, { senderId: i.senderId, shelf: i.shelf, topic: i.topic, n: 1 });
    }
    return { counts: [...tally.values()], saved: issues.filter((i) => i.savedAt).length };
  }
  async related(id: string): Promise<RelatedResponse> {
    await delay();
    // A stand-in for the API's nearest neighbours: other issues on the same topic.
    const me = issues.find((i) => i.id === id);
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const own = me ? mockStories(me).stories : [];
    if (me && own.length > 1) {
      // A digest: each story's relatives are other issues' stories sharing a word with it.
      const words = (t: string) => new Set(queryTerms(t).filter((w) => w.length >= 4));
      const theirs = issues
        .filter((i) => i.id !== id && !i.promo && !muted.has(i.senderId))
        .flatMap((i) => {
          const st = mockStories(i).stories;
          return st.map((s) => ({ i, s, digest: st.length > 1, words: words(s.headline) }));
        });
      const stories = own.flatMap((s) => {
        const mine = words(s.headline);
        const seen = new Set<string>();
        const near = theirs
          .filter((t) => [...t.words].some((w) => mine.has(w)) && !seen.has(t.i.id))
          .filter((t) => seen.add(t.i.id))
          .slice(0, 3)
          .map((t) => ({
            ...strip(t.i),
            similarity: 0.5,
            ...(t.digest ? { story: { n: t.s.n, headline: t.s.headline } } : {}),
          }));
        const before = (i: IssueListItem) => i.receivedAt < me.receivedAt;
        return near.length
          ? [
              {
                n: s.n,
                headline: s.headline,
                earlier: near.filter(before),
                since: near.filter((i) => !before(i)),
              },
            ]
          : [];
      });
      return { earlier: [], since: [], stories };
    }
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

  async stories(id: string): Promise<IssueStoriesResponse> {
    await delay(250);
    return mockStories(find(id));
  }

  /**
   * Search (#53) by the API's word rules over the mock issues and their stories. The mock has no
   * embeddings, so a stand-in for search by meaning: other issues on the topic of the best match.
   */
  async search(q: string, sort: SearchSort): Promise<SearchResponse> {
    await delay(200);
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const listed = issues.filter((i) => !i.promo && !muted.has(i.senderId));
    const stories = new Map(listed.map((i) => [i.id, mockStories(i).stories]));
    const docs = listed.flatMap((i) => [
      issueDoc(i),
      ...stories.get(i.id)!.map((s) => storyDoc({ ...s, id: i.id }, i.publication)),
    ]);
    const terms = queryTerms(q);
    const byWords = rankByWords(terms, docs).filter((m) => !m.partial);
    const found = new Set(byWords.map((m) => m.issueId));
    const topic = listed.find((i) => i.id === byWords[0]?.issueId)?.topic;
    const near = listed.filter((i) => topic && i.topic === topic && !found.has(i.id)).slice(0, 3);
    const hit = (id: string, match: SearchHit["match"], story?: number): SearchHit => {
      const i = find(id);
      const all = stories.get(id) ?? [];
      const headline = all.length > 1 ? all.find((s) => s.n === story)?.headline : undefined;
      return {
        ...withStar(strip(i)),
        match,
        ...(headline ? { story: { n: story!, headline } } : {}),
      };
    };
    const newest = (a: SearchHit, b: SearchHit) => b.receivedAt.localeCompare(a.receivedAt);
    const words = byWords.map((m) => hit(m.issueId, "words", m.story));
    const meaning = near.map((i) => hit(i.id, "meaning", 1));
    if (sort === "newest") {
      words.sort(newest);
      meaning.sort(newest);
    }
    return { q, terms, items: [...words, ...meaning], byMeaning: true };
  }

  async summary(): Promise<SummaryResponse> {
    await delay();
    // A stand-in for the API's ranking: Must Read and AI topics lift, freshness decays.
    const must = mustSet();
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const news = issues.filter(
      (i) =>
        i.state === "unread" &&
        i.savedAt === undefined &&
        (i.shelf ?? "news") === "news" &&
        !muted.has(i.senderId),
    );
    const scored = news.map((i) => {
      const fresh = 0.5 ** ((now - Date.parse(i.receivedAt)) / HOUR / 48);
      const sender = must.has(i.senderId) ? 0.75 : 0.5;
      const topic = i.topic?.startsWith("AI") ? 0.8 : 0.5;
      const up = senders.find((x) => x.senderId === i.senderId)?.up ?? 0;
      const reason =
        up > 0
          ? `You rated this newsletter Relevant ${up === 1 ? "once" : up === 2 ? "twice" : `${up} times`}`
          : sender > 0.5
            ? "From a Must Read newsletter"
            : topic > 0.5
              ? "Close to your interest in AI"
              : fresh > 0.9
                ? "Just in"
                : "Trying a newsletter you haven't rated yet";
      return { i, score: 0.4 * sender + 0.4 * topic + 0.2 * fresh, reason };
    });
    scored.sort((a, b) => b.score - a.score);
    return {
      items: scored.slice(0, 20).map((s) => ({ ...withStar(strip(s.i)), scoreReason: s.reason })),
      candidates: news.length,
      digest: (mockDigest ??= scored.slice(0, 5).map((s) => s.i.id)),
      digestAt: (mockDigestAt ??= new Date().toISOString()),
      digestStats: digestStats(),
      narrative: mockNarrative(scored.map((s) => s.i)),
    };
  }
  async history(day?: string): Promise<HistoryResponse> {
    await delay();
    return mockHistory(day ?? readerDay(now));
  }
  async rate(id: string, value: Rating | 0) {
    await delay(80);
    const i = find(id);
    const s = senders.find((x) => x.senderId === i.senderId)!;
    if (i.rating === 1) s.up--;
    if (i.rating === -1) s.down--;
    i.rating = value === 0 ? undefined : value;
    i.ratedAt = value === 0 ? undefined : new Date().toISOString();
    if (value === 1) s.up++;
    if (value === -1) s.down++;
    return strip(i);
  }
  async logOpen(id: string) {
    const at = new Date().toISOString();
    const kept = mockPlace?.issueId === id ? mockPlace.position : 0;
    mockPlace = { issueId: id, position: kept < 1 ? kept : 0, since: at, at };
  }
  /** The mock's history is a stand-in (see mockHistory), so a peek leaves it as it is. */
  async logPeek(id: string) {
    find(id);
    await delay(20);
  }
  async nowReading(): Promise<NowReadingResponse> {
    await delay();
    return mockNowReading();
  }
  async savePosition(id: string, position: number) {
    const at = new Date().toISOString();
    if (mockPlace?.issueId === id) Object.assign(mockPlace, { position, at });
    else if (position < 1) mockPlace = { issueId: id, position, since: at, at };
  }
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
