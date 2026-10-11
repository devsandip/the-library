/**
 * Search (#53): what the newsletters said, by words and by meaning, over the corpus
 * (`./corpus.ts`), which is read once and kept for a few minutes; the rows shown are read fresh.
 */
import { queryTerms, searchIssues } from "@library/core";
import type {
  IssueListItem,
  SearchHit,
  SearchResponse,
  SearchSort,
  SenderListItem,
} from "@library/core/types";
import type { CorpusCache } from "./corpus.js";
import type { SearchPort } from "./port.js";

/** Where search reads the rows it shows. DynamoRepo implements it; tests use a fake. */
export interface SearchSource {
  listSenders(): Promise<SenderListItem[]>;
  /** These issues as list rows, read now; any filtered since are left out. */
  listItems(ids: string[]): Promise<IssueListItem[]>;
}

export interface Embedder {
  embed(text: string): Promise<Float32Array>;
}

/** Results per search. */
export const SEARCH_LIMIT = 50;
/** Query embeddings kept, so a query typed again costs no Titan call. */
const EMBEDDINGS_KEPT = 200;

export class Search implements SearchPort {
  private readonly embeddings = new Map<string, Float32Array>();

  constructor(
    private readonly source: SearchSource,
    private readonly embedder: Embedder,
    private readonly corpus: CorpusCache,
  ) {}

  async search(q: string, sort: SearchSort): Promise<SearchResponse> {
    const terms = queryTerms(q);
    const [corpus, senders, vector] = await Promise.all([
      this.corpus.load(),
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
