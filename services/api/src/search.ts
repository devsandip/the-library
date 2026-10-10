/**
 * Search (#53): what the newsletters said, by words and by meaning. The corpus (every listed
 * issue's words, every story with its embedding) is read once and kept for a few minutes, so a
 * query typed a few letters at a time reads DynamoDB once; the rows shown are read fresh.
 */
import {
  issueDoc,
  queryTerms,
  searchIssues,
  storyDoc,
  type SearchDoc,
  type StoryVector,
} from "@library/core";
import type {
  IssueListItem,
  SearchHit,
  SearchResponse,
  SearchSort,
  SenderListItem,
} from "@library/core/types";
import type { SearchPort } from "./port.js";

/** An issue as search reads it. */
export interface CorpusIssue {
  id: string;
  senderId: string;
  publication: string;
  subject: string;
  summary?: string;
  promo?: boolean;
}

/** A story as search reads it, with its embedding when it has one. */
export interface CorpusStory {
  id: string;
  n: number;
  headline: string;
  summary: string;
  names: string[];
  vector?: Float32Array;
}

/** Where search reads from. DynamoRepo implements it; tests use a fake. */
export interface SearchSource {
  /** Every listed issue, and every story with its embedding. */
  searchCorpus(): Promise<{ issues: CorpusIssue[]; stories: CorpusStory[] }>;
  listSenders(): Promise<SenderListItem[]>;
  /** These issues as list rows, read now; any filtered since are left out. */
  listItems(ids: string[]): Promise<IssueListItem[]>;
}

export interface Embedder {
  embed(text: string): Promise<Float32Array>;
}

/** Results per search. */
export const SEARCH_LIMIT = 50;
/** How long a corpus read serves searches: a new issue is searchable within this long. */
export const CORPUS_TTL_MS = 5 * 60_000;
/** Query embeddings kept, so a query typed again costs no Titan call. */
const EMBEDDINGS_KEPT = 200;

interface Corpus {
  issues: Map<string, CorpusIssue>;
  docs: SearchDoc[];
  stories: StoryVector[];
  /** Headlines by "<issueId>#<n>". */
  headlines: Map<string, string>;
  /** How many stories each issue was split into. */
  storyCount: Map<string, number>;
}

/** Promos are left out here; muted newsletters per search, since muting is a click away. */
function build(read: { issues: CorpusIssue[]; stories: CorpusStory[] }): Corpus {
  const issues = new Map(read.issues.filter((i) => !i.promo).map((i) => [i.id, i]));
  const docs = [...issues.values()].map(issueDoc);
  const stories: StoryVector[] = [];
  const headlines = new Map<string, string>();
  const storyCount = new Map<string, number>();
  for (const s of read.stories) {
    const issue = issues.get(s.id);
    if (!issue) continue;
    docs.push(storyDoc(s, issue.publication));
    if (s.vector) stories.push({ issueId: s.id, n: s.n, vector: s.vector });
    headlines.set(`${s.id}#${s.n}`, s.headline);
    storyCount.set(s.id, (storyCount.get(s.id) ?? 0) + 1);
  }
  return { issues, docs, stories, headlines, storyCount };
}

export class Search implements SearchPort {
  private corpus?: { at: number; value: Promise<Corpus> };
  private readonly embeddings = new Map<string, Float32Array>();

  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly source: SearchSource,
    private readonly embedder: Embedder,
    opts: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.ttlMs = opts.ttlMs ?? CORPUS_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  async search(q: string, sort: SearchSort): Promise<SearchResponse> {
    const terms = queryTerms(q);
    const [corpus, senders, vector] = await Promise.all([
      this.load(),
      this.source.listSenders(),
      this.embed(q),
    ]);
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const listed = (id: string) => !muted.has(corpus.issues.get(id)?.senderId ?? "");
    const matches = searchIssues(terms, vector, {
      docs: muted.size ? corpus.docs.filter((d) => listed(d.issueId)) : corpus.docs,
      stories: muted.size ? corpus.stories.filter((s) => listed(s.issueId)) : corpus.stories,
    }).slice(0, SEARCH_LIMIT);

    const rows = new Map(
      (await this.source.listItems(matches.map((m) => m.issueId))).map((i) => [i.id, i]),
    );
    const starred = new Set(senders.filter((s) => s.mustRead).map((s) => s.senderId));
    const items: SearchHit[] = [];
    for (const m of matches) {
      const row = rows.get(m.issueId);
      // Claude may have found it to be a promo since the corpus was read.
      if (!row || row.promo) continue;
      // A story's headline tells something only inside a digest: one story is the issue itself.
      const digest = (corpus.storyCount.get(m.issueId) ?? 0) > 1;
      const headline =
        digest && m.story !== undefined
          ? corpus.headlines.get(`${m.issueId}#${m.story}`)
          : undefined;
      items.push({
        ...row,
        ...(starred.has(row.senderId) ? { mustRead: true } : {}),
        match: m.match,
        ...(headline ? { story: { n: m.story!, headline } } : {}),
      });
    }
    if (sort === "newest") {
      const newest = (a: SearchHit, b: SearchHit) => b.receivedAt.localeCompare(a.receivedAt);
      const words = items.filter((i) => i.match !== "meaning").sort(newest);
      const meaning = items.filter((i) => i.match === "meaning").sort(newest);
      return { q, terms, items: [...words, ...meaning], byMeaning: vector !== undefined };
    }
    return { q, terms, items, byMeaning: vector !== undefined };
  }

  private load(): Promise<Corpus> {
    const now = this.now();
    if (!this.corpus || now - this.corpus.at > this.ttlMs) {
      const value = this.source.searchCorpus().then((read) => {
        const corpus = build(read);
        console.log(
          JSON.stringify({
            level: "info",
            msg: "search corpus read",
            issues: corpus.issues.size,
            stories: corpus.stories.length,
            ms: this.now() - now,
          }),
        );
        return corpus;
      });
      // A failed read is not kept: the next search tries again.
      value.catch(() => {
        if (this.corpus?.value === value) this.corpus = undefined;
      });
      this.corpus = { at: now, value };
    }
    return this.corpus.value;
  }

  /** The query's embedding, or undefined when Titan fails: the search goes on by words alone. */
  private async embed(q: string): Promise<Float32Array | undefined> {
    const key = q.toLowerCase();
    const kept = this.embeddings.get(key);
    if (kept) return kept;
    try {
      const vector = await this.embedder.embed(q);
      if (this.embeddings.size >= EMBEDDINGS_KEPT) {
        this.embeddings.delete(this.embeddings.keys().next().value!);
      }
      this.embeddings.set(key, vector);
      return vector;
    } catch (err) {
      console.error(
        JSON.stringify({ level: "error", msg: "query embedding failed", error: String(err) }),
      );
      return undefined;
    }
  }
}
