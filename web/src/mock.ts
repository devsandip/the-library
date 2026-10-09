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
  StatusResponse,
  View,
} from "@library/core/types";
import type { LibraryApi } from "./api.js";

const HOUR = 3_600_000;
const now = Date.now();

const senders: SenderListItem[] = [
  ["s000000000001", "bytebytego@substack.com", "ByteByteGo", true],
  ["s000000000002", "casey@platformer.news", "Platformer", true],
  ["s000000000003", "lenny@substack.com", "Lenny's Newsletter", true],
  ["s000000000004", "pragmaticengineer@substack.com", "The Pragmatic Engineer", true],
  ["s000000000005", "dan@tldrnewsletter.com", "TLDR AI", true],
  ["s000000000006", "hello@example-weekly.test", "Example Weekly", false],
].map(([senderId, senderKey, publication, keep]) => ({
  senderId: senderId as string,
  senderKey: senderKey as string,
  publication: publication as string,
  muted: false,
  onKeepList: keep as boolean,
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
    html: sampleHtml(subject, s.publication),
  };
});

/** Offline placeholder image, so mock mode makes no network requests. */
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#d9d4c7"/><path d="M0 480 L300 300 L520 420 L800 220 L1200 460 V600 H0Z" fill="#b8b09c"/></svg>',
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

function find(id: string) {
  const issue = issues.find((i) => i.id === id);
  if (!issue) throw new Error("issue not found");
  return issue;
}

export class MockLibraryApi implements LibraryApi {
  async listIssues(opts: {
    view: View;
    sender?: string;
    cursor?: string;
    limit?: number;
  }): Promise<IssueListResponse> {
    await delay();
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const all = issues.filter(
      (i) =>
        statesFor[opts.view].includes(i.state) &&
        (opts.sender
          ? i.senderId === opts.sender
          : opts.view === "archived" || !muted.has(i.senderId)),
    );
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const limit = opts.limit ?? 30;
    const page = all.slice(start, start + limit).map(strip);
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
  async setMuted(senderId: string, muted: boolean) {
    await delay(80);
    const s = senders.find((x) => x.senderId === senderId)!;
    s.muted = muted;
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
