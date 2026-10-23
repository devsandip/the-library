/**
 * The archive as search (#53) and related stories (#20) read it: every listed issue's words, and
 * every story with its embedding. Read once and kept for a few minutes in the warm Lambda, so a
 * query typed a few letters at a time, or an issue opened after a search, reads DynamoDB once.
 */
import {
  issueDoc,
  storyDoc,
  type SearchDoc,
  type StoryCandidate,
  type StoryVector,
} from "@library/core";

/** An issue as the corpus reads it. */
export interface CorpusIssue {
  id: string;
  senderId: string;
  publication: string;
  subject: string;
  summary?: string;
  promo?: boolean;
  receivedAt: string;
}

/** A story as the corpus reads it, with its embedding when it has one. */
export interface CorpusStory {
  id: string;
  n: number;
  headline: string;
  summary: string;
  names: string[];
  vector?: Float32Array;
}

/** Where the corpus is read from. DynamoRepo implements it; tests use a fake. */
export interface CorpusSource {
  /** Every listed issue, and every story with its embedding. */
  readCorpus(): Promise<{ issues: CorpusIssue[]; stories: CorpusStory[] }>;
}

export interface Corpus {
  /** Listed issues, promos left out; muted newsletters stay, since muting is a click away. */
  issues: Map<string, CorpusIssue>;
  /** Search's documents: each issue and each story. */
  docs: SearchDoc[];
  /** Every embedded story, for search by meaning. */
  stories: StoryVector[];
  /** The same stories with their issue's newsletter and date, for related stories. */
  candidates: StoryCandidate[];
  /** Headlines by "<issueId>#<n>". */
  headlines: Map<string, string>;
  /** Every story by "<issueId>#<n>", for its words (#19). */
  storiesByKey: Map<string, CorpusStory>;
  /** How many stories each issue was split into. */
  storyCount: Map<string, number>;
}

/** How long a corpus read serves: a new issue is searchable within this long. */
export const CORPUS_TTL_MS = 5 * 60_000;

export function buildCorpus(read: { issues: CorpusIssue[]; stories: CorpusStory[] }): Corpus {
  const issues = new Map(read.issues.filter((i) => !i.promo).map((i) => [i.id, i]));
  const docs = [...issues.values()].map(issueDoc);
  const stories: StoryVector[] = [];
  const candidates: StoryCandidate[] = [];
  const headlines = new Map<string, string>();
  const storiesByKey = new Map<string, CorpusStory>();
  const storyCount = new Map<string, number>();
  for (const s of read.stories) {
    const issue = issues.get(s.id);
    if (!issue) continue;
    docs.push(storyDoc(s, issue.publication));
    if (s.vector) {
      stories.push({ issueId: s.id, n: s.n, vector: s.vector });
      candidates.push({
        issueId: s.id,
        n: s.n,
        senderId: issue.senderId,
        receivedAt: issue.receivedAt,
        vector: s.vector,
      });
    }
    headlines.set(`${s.id}#${s.n}`, s.headline);
    storiesByKey.set(`${s.id}#${s.n}`, s);
    storyCount.set(s.id, (storyCount.get(s.id) ?? 0) + 1);
  }
  return { issues, docs, stories, candidates, headlines, storiesByKey, storyCount };
}

/** The corpus, read at most once per `ttlMs`. A failed read is not kept: the next call tries again. */
export class CorpusCache {
  private corpus?: { at: number; value: Promise<Corpus> };
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly source: CorpusSource,
    opts: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.ttlMs = opts.ttlMs ?? CORPUS_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  load(): Promise<Corpus> {
    const now = this.now();
    if (!this.corpus || now - this.corpus.at > this.ttlMs) {
      const value = this.source.readCorpus().then((read) => {
        const corpus = buildCorpus(read);
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
      value.catch(() => {
        if (this.corpus?.value === value) this.corpus = undefined;
      });
      this.corpus = { at: now, value };
    }
    return this.corpus.value;
  }
}
