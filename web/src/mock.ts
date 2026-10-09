/**
 * In-memory backend for local UI work (VITE_MOCK=1 pnpm --filter @library/web dev).
 * Loaded with a dynamic import, so production bundles never include it.
 */
import type {
  IssueDetailResponse,
  IssueListItem,
  IssueListResponse,
  Rating,
  ReaderState,
  SenderDetailResponse,
  SenderListItem,
  SenderListResponse,
  SenderPatch,
  Shelf,
  StatusResponse,
  Topic,
  TopicListResponse,
  View,
} from "@library/core/types";
import type { LibraryApi, ListIssuesOptions } from "./api.js";

const HOUR = 3_600_000;
const now = Date.now();

const senders: SenderListItem[] = [
  ["s000000000001", "bytebytego@substack.com", "ByteByteGo", true],
  ["s000000000002", "casey@platformer.news", "Platformer", true],
  ["s000000000003", "lenny@substack.com", "Lenny's Newsletter", false],
  ["s000000000004", "pragmaticengineer@substack.com", "The Pragmatic Engineer", false],
  ["s000000000005", "dan@tldrnewsletter.com#tldr-ai", "TLDR AI", false],
  ["s000000000006", "hello@example-weekly.test", "Example Weekly", false],
].map(([senderId, senderKey, publication, mustRead]) => ({
  senderId: senderId as string,
  senderKey: senderKey as string,
  publication: publication as string,
  muted: false,
  mustRead: mustRead as boolean,
  up: 0,
  down: 0,
  issueCount: 0,
  lastSeenAt: new Date(now).toISOString(),
  unsubscribeUrl: `https://example.test/unsubscribe/${senderId}`,
}));

const subjects = [
  "How Discord stores trillions of messages",
  "The AI search wars heat up, and what it means for publishers",
  "How I AI: building product specs with Claude",
  "Deepdive: How Stripe designs APIs that last a decade",
  "OpenAI ships agents; Anthropic publishes interpretability research",
  "Images from everywhere",
  "Consistent hashing, explained with one diagram",
  "Why most product roadmaps fail in month three",
  "The quiet return of the monolith",
  "A field guide to pricing pages",
];

const topics: Topic[] = [
  { name: "AI", description: "Models, tools and the AI industry" },
  { name: "Engineering", description: "Systems, architecture and engineering practice" },
  { name: "Product", description: "Product management craft" },
  { name: "Business", description: "Companies, markets and deals" },
];

/** Claude's call per subject above; the sixth issue is not sorted yet (shows under News). */
const sorted: [Shelf, string][] = [
  ["learning", "Engineering"],
  ["news", "AI"],
  ["learning", "Product"],
  ["learning", "Engineering"],
  ["news", "AI"],
  ["news", ""],
  ["learning", "Engineering"],
  ["learning", "Product"],
  ["learning", "Engineering"],
  ["news", "Business"],
];

/** Offline placeholder image, so mock mode makes no network requests. */
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#d9d4c7"/><path d="M0 480 L300 300 L520 420 L800 220 L1200 460 V600 H0Z" fill="#b8b09c"/></svg>',
  );

const issues: (IssueListItem & { html: string })[] = subjects.map((subject, i) => {
  const s = senders[i % senders.length]!;
  s.issueCount++;
  return {
    id: `mock-${i + 1}`,
    senderId: s.senderId,
    publication: s.publication,
    subject,
    snippet:
      "A short preview line from the top of the issue, the way Gmail shows it in the inbox list.",
    receivedAt: new Date(now - i * 5 * HOUR).toISOString(),
    readMinutes: 3 + (i % 7),
    state: i > 7 ? "read" : "unread",
    viewOnlineUrl: `https://example.test/p/${i + 1}`,
    ...(i === 5 ? {} : { shelf: sorted[i]![0], topic: sorted[i]![1] || undefined }),
    summary: i === 5 ? undefined : `A one-line summary of "${subject}", as Claude writes it.`,
    html: sampleHtml(subject, s.publication),
  };
});

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

function find(id: string) {
  const issue = issues.find((i) => i.id === id);
  if (!issue) throw new Error("issue not found");
  return issue;
}

export class MockLibraryApi implements LibraryApi {
  async listIssues(opts: ListIssuesOptions): Promise<IssueListResponse> {
    await delay();
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const must = new Set(senders.filter((s) => s.mustRead).map((s) => s.senderId));
    const matching = issues.filter(
      (i) =>
        statesFor[opts.view].includes(i.state) &&
        (opts.sender
          ? i.senderId === opts.sender
          : opts.view === "archived" || !muted.has(i.senderId)) &&
        (!opts.shelf || (i.shelf ?? "news") === opts.shelf) &&
        (!opts.topic || i.topic === opts.topic),
    );
    // Unread lists Must Read newsletters first, like the API.
    const all =
      opts.view === "unread" && !opts.sender
        ? [
            ...matching.filter((i) => must.has(i.senderId)),
            ...matching.filter((i) => !must.has(i.senderId)),
          ]
        : matching;
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const limit = opts.limit ?? 30;
    const page = all
      .slice(start, start + limit)
      .map((i) => (must.has(i.senderId) ? { ...strip(i), mustRead: true } : strip(i)));
    return { items: page, cursor: start + limit < all.length ? String(start + limit) : undefined };
  }
  async getIssue(id: string): Promise<IssueDetailResponse> {
    await delay();
    const i = find(id);
    return {
      ...strip(i),
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
      issues: issues.filter((i) => i.senderId === senderId).map(strip),
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
    };
  }
}
