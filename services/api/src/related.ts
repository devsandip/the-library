/**
 * Related stories (#20, second version): the open issue's stories, read now, against every story
 * in the corpus (`./corpus.ts`, shared with search). An issue not split into stories falls back
 * to the first version's whole-issue match. No Claude call, nothing stored.
 */
import { relatedStories, type StoryCandidate, type StoryMatch } from "@library/core";
import type {
  IssueListItem,
  RelatedItem,
  RelatedResponse,
  RelatedStory,
  SenderListItem,
} from "@library/core/types";
import type { CorpusCache } from "./corpus.js";
import type { RelatedPort } from "./port.js";

/** An issue's own story with its embedding. */
export interface OwnStory extends StoryCandidate {
  headline: string;
}

/** Where related stories read from. DynamoRepo implements it; tests use a fake. */
export interface RelatedSource {
  /** The issue's stories with their embeddings, read now: the corpus may predate its split. */
  storyVectors(id: string): Promise<OwnStory[]>;
  /** Issues related to the whole issue (the first version), for one not split into stories. */
  relatedIssues(id: string): Promise<RelatedResponse>;
  listSenders(): Promise<SenderListItem[]>;
  /** These issues as list rows, read now; any filtered since are left out. */
  listItems(ids: string[]): Promise<IssueListItem[]>;
}

export class Related implements RelatedPort {
  constructor(
    private readonly source: RelatedSource,
    private readonly corpus: CorpusCache,
  ) {}

  async related(id: string): Promise<RelatedResponse> {
    const own = await this.source.storyVectors(id);
    if (!own.length) return this.source.relatedIssues(id);
    const [corpus, senders] = await Promise.all([this.corpus.load(), this.source.listSenders()]);
    const muted = new Set(senders.filter((s) => s.muted).map((s) => s.senderId));
    const found = relatedStories(own, corpus.candidates, {
      eligible: (c) => !muted.has(c.senderId),
    });

    const all = [found, ...found.stories].flatMap((s) => [...s.earlier, ...s.since]);
    const rows = new Map(
      (await this.source.listItems([...new Set(all.map((m) => m.issueId))])).map((i) => [i.id, i]),
    );
    const items = (matches: StoryMatch[]): RelatedItem[] =>
      matches.flatMap((m) => {
        const row = rows.get(m.issueId);
        // Claude may have found it to be a promo since the corpus was read.
        if (!row || row.promo) return [];
        // A story's headline tells something only inside a digest: one story is the issue itself.
        const digest = (corpus.storyCount.get(m.issueId) ?? 0) > 1;
        const headline = digest ? corpus.headlines.get(`${m.issueId}#${m.n}`) : undefined;
        return [
          {
            ...row,
            similarity: Math.round(m.similarity * 1000) / 1000,
            ...(headline ? { story: { n: m.n, headline } } : {}),
          },
        ];
      });

    const headlines = new Map(own.map((s) => [s.n, s.headline]));
    const stories: RelatedStory[] = found.stories.flatMap((s) => {
      const group = { earlier: items(s.earlier), since: items(s.since) };
      return group.earlier.length || group.since.length
        ? [{ n: s.n, headline: headlines.get(s.n) ?? "", ...group }]
        : [];
    });
    return {
      earlier: items(found.earlier),
      since: items(found.since),
      ...(own.length > 1 ? { stories } : {}),
    };
  }
}
