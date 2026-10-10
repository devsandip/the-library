/**
 * Search over what the newsletters said (#53). By words: the issues' subjects, newsletter names
 * and Claude's lines, and the story index's headlines, summaries and names (#15). By meaning: the
 * query's embedding against every story's. The two lists become one by reciprocal rank fusion.
 * Pure functions: the API ranks with them and the web highlights with the same word rules. They
 * are also the archive searches Ask the Library (#21) will call.
 */

/** Words that match nearly everything, left out of a query. */
const STOPWORDS = new Set(
  (
    "a about after an and are as at be but by did do does for from had has have how i if in " +
    "into is it its me my not of on or our so than that the their them then there these they " +
    "this to too us was we were what when where which who why will with you your"
  ).split(" "),
);

/** A query's first few terms are plenty; more only slow the scoring. */
export const MAX_TERMS = 8;

/** A word in a subject or headline says more than one deep in a summary. */
export const SEARCH_WEIGHTS = {
  subject: 3,
  publication: 2,
  summary: 1.5,
  headline: 3,
  names: 2.5,
  storySummary: 1,
  storyPublication: 1,
} as const;

/** A longer word a term only starts ("ratelimit" for "rate") counts for less than the word. */
const PREFIX_MATCH = 0.6;

/** BM25's saturation: a term's tenth mention adds little. */
const K1 = 1.2;

/**
 * The cosine a story needs to count as close in meaning. On prod's 2,242 stories (2026-10-11),
 * relevant stories scored 0.30 to 0.57, and queries with nothing relevant in the archive
 * ("gardening tips", "rate cut") topped out under 0.30.
 */
export const MEANING_FLOOR = 0.3;

/**
 * The looser cosine an issue missing one of three or more terms needs: on prod, the right ones
 * for "product manager interviews" ("Inside Gemini: How Google runs product") scored 0.21 to
 * 0.27, the noise ("Restaurant supply tycoon builds family office") under 0.16.
 */
export const LOOSE_FLOOR = 0.2;

/**
 * Two query terms side by side in a field count again: "rate limiting" in a walkthrough beats
 * "rate" and "limit" in different sentences of a markets digest.
 */
const PHRASE_BONUS = 1;

/** Reciprocal rank fusion's usual constant: one list's top places do not swamp the other's. */
export const RRF_K = 60;

const fold = (w: string) => w.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const WORD = /[\p{L}\p{N}]+/gu;
const rawWords = (text: string) => text.match(WORD) ?? [];

// ---------- Porter's stemmer (1980) ----------

const isConsonant = (w: string, i: number): boolean => {
  const c = w[i]!;
  if ("aeiou".includes(c)) return false;
  return c === "y" ? i === 0 || !isConsonant(w, i - 1) : true;
};

/** Porter's m: how many vowel-consonant runs follow the stem's first consonants. */
function measure(s: string): number {
  let m = 0;
  let i = 0;
  while (i < s.length && isConsonant(s, i)) i++;
  while (i < s.length) {
    while (i < s.length && !isConsonant(s, i)) i++;
    if (i >= s.length) break;
    while (i < s.length && isConsonant(s, i)) i++;
    m++;
  }
  return m;
}

const hasVowel = (s: string) => [...s].some((_, i) => !isConsonant(s, i));
const endsDouble = (s: string) =>
  s.length >= 2 && s.at(-1) === s.at(-2) && isConsonant(s, s.length - 1);
/** Ends consonant, vowel, consonant, the last not w, x or y ("hop", "wil"). */
const endsCvc = (s: string) => {
  const n = s.length;
  return (
    n >= 3 &&
    isConsonant(s, n - 3) &&
    !isConsonant(s, n - 2) &&
    isConsonant(s, n - 1) &&
    !"wxy".includes(s[n - 1]!)
  );
};

const byLength = (rules: [string, string][]) => rules.sort((a, b) => b[0].length - a[0].length);
const STEP2 = byLength([
  ["ational", "ate"],
  ["tional", "tion"],
  ["enci", "ence"],
  ["anci", "ance"],
  ["izer", "ize"],
  ["abli", "able"],
  ["alli", "al"],
  ["entli", "ent"],
  ["eli", "e"],
  ["ousli", "ous"],
  ["ization", "ize"],
  ["ation", "ate"],
  ["ator", "ate"],
  ["alism", "al"],
  ["iveness", "ive"],
  ["fulness", "ful"],
  ["ousness", "ous"],
  ["aliti", "al"],
  ["iviti", "ive"],
  ["biliti", "ble"],
]);
const STEP3 = byLength([
  ["icate", "ic"],
  ["ative", ""],
  ["alize", "al"],
  ["iciti", "ic"],
  ["ical", "ic"],
  ["ful", ""],
  ["ness", ""],
]);
const STEP4 = byLength(
  "al ance ence er ic able ible ant ement ment ent ion ou ism ate iti ous ive ize"
    .split(" ")
    .map((x): [string, string] => [x, ""]),
);

/** The longest suffix in `rules` decides: replaced when the stem's m is over `over`, else kept. */
function replaceSuffix(w: string, rules: [string, string][], over: number): string {
  const rule = rules.find(([suffix]) => w.endsWith(suffix));
  if (!rule) return w;
  const s = w.slice(0, -rule[0].length);
  if (measure(s) <= over || (rule[0] === "ion" && !/[st]$/.test(s))) return w;
  return s + rule[1];
}

/**
 * Porter's stemmer, so "limiting", "limits" and "limiter" are one word, and "manager" and
 * "management" too. Lowercase English words only; anything else passes through.
 */
export function stem(word: string): string {
  if (word.length <= 2 || !/^[a-z]+$/.test(word)) return word;
  let w = word;
  // Step 1a: plurals.
  if (w.endsWith("sses") || w.endsWith("ies")) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  // Step 1b: -eed, -ed, -ing.
  if (w.endsWith("eed")) {
    if (measure(w.slice(0, -3)) > 0) w = w.slice(0, -1);
  } else {
    const cut = w.endsWith("ed") ? 2 : w.endsWith("ing") ? 3 : 0;
    const s = w.slice(0, -cut);
    if (cut && hasVowel(s)) {
      if (/(at|bl|iz)$/.test(s)) w = `${s}e`;
      else if (endsDouble(s) && !/[lsz]$/.test(s)) w = s.slice(0, -1);
      else if (measure(s) === 1 && endsCvc(s)) w = `${s}e`;
      else w = s;
    }
  }
  // Step 1c: a final y after a vowel.
  if (w.endsWith("y") && hasVowel(w.slice(0, -1))) w = `${w.slice(0, -1)}i`;
  w = replaceSuffix(w, STEP2, 0);
  w = replaceSuffix(w, STEP3, 0);
  w = replaceSuffix(w, STEP4, 1);
  // Step 5: a final e, and a double l.
  if (w.endsWith("e")) {
    const s = w.slice(0, -1);
    const m = measure(s);
    if (m > 1 || (m === 1 && !endsCvc(s))) w = s;
  }
  if (w.endsWith("ll") && measure(w) > 1) w = w.slice(0, -1);
  return w;
}

// ---------- words, terms and matching ----------

/** A text's words as search compares them: lowercase, without accents, stemmed. */
export function searchWords(text: string): string[] {
  return rawWords(text).map((w) => stem(fold(w)));
}

/** A query's terms: its words, less single letters and the words that match nearly everything. */
export function queryTerms(q: string): string[] {
  const terms: string[] = [];
  for (const raw of rawWords(q)) {
    const w = fold(raw);
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    const t = stem(w);
    if (!terms.includes(t)) terms.push(t);
  }
  return terms.slice(0, MAX_TERMS);
}

/**
 * How well a word matches a term: 1 for the word itself; less for a longer word the term starts,
 * once the term has three letters, so "ai" never matches "aid" but "agent" matches "agentic".
 */
export function matchWeight(term: string, word: string): number {
  if (word === term) return 1;
  return term.length >= 3 && word.startsWith(term) ? PREFIX_MATCH : 0;
}

export interface SearchField {
  words: string[];
  weight: number;
}

/** An issue, or one of its stories, as search by words reads it. */
export interface SearchDoc {
  issueId: string;
  /** The story's number; absent for the issue itself. */
  story?: number;
  fields: SearchField[];
}

const field = (text: string | undefined, weight: number): SearchField => ({
  words: searchWords(text ?? ""),
  weight,
});

export function issueDoc(i: {
  id: string;
  subject: string;
  publication: string;
  summary?: string;
}): SearchDoc {
  return {
    issueId: i.id,
    fields: [
      field(i.subject, SEARCH_WEIGHTS.subject),
      field(i.publication, SEARCH_WEIGHTS.publication),
      field(i.summary, SEARCH_WEIGHTS.summary),
    ],
  };
}

/** A story carries its newsletter's name, so "TLDR agents" finds TLDR's story about agents. */
export function storyDoc(
  s: { id: string; n: number; headline: string; summary: string; names?: string[] },
  publication: string,
): SearchDoc {
  return {
    issueId: s.id,
    story: s.n,
    fields: [
      field(s.headline, SEARCH_WEIGHTS.headline),
      field((s.names ?? []).join(" "), SEARCH_WEIGHTS.names),
      field(s.summary, SEARCH_WEIGHTS.storySummary),
      field(publication, SEARCH_WEIGHTS.storyPublication),
    ],
  };
}

/** An issue a search found, and the story inside it that matched best. */
export interface SearchMatch {
  issueId: string;
  score: number;
  story?: number;
  /** Matched all of the query's terms but one. */
  partial?: true;
}

/** Whether two terms stand side by side, in order, in any of the document's fields. */
function adjacent(doc: SearchDoc, a: string, b: string): boolean {
  return doc.fields.some((f) =>
    f.words.some(
      (w, i) =>
        i + 1 < f.words.length && matchWeight(a, w) > 0 && matchWeight(b, f.words[i + 1]!) > 0,
    ),
  );
}

/**
 * Issues that hold the query's terms, in the issue itself (subject, newsletter, Claude's line) or
 * in one of its stories, best first. Every term; or, with three terms or more, all but one
 * (`partial`, ranked after the rest; `searchIssues` keeps only those also close in meaning).
 * BM25 over the weighted fields, so a rare term weighs more than a common one, plus a bonus for
 * terms side by side. An issue scores its best document, and its best-scoring story is the one
 * to show, even when the subject scored higher.
 */
export function rankByWords(terms: string[], docs: SearchDoc[]): SearchMatch[] {
  if (!terms.length || !docs.length) return [];
  const need = terms.length >= 3 ? terms.length - 1 : terms.length;
  const tf = docs.map((doc) =>
    terms.map((t) => {
      let x = 0;
      for (const f of doc.fields) for (const w of f.words) x += f.weight * matchWeight(t, w);
      return x;
    }),
  );
  const idf = terms.map((_, k) => {
    const df = tf.filter((row) => row[k]! > 0).length;
    return Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
  });
  type Hit = SearchMatch & { matched: number; storyRank: [number, number] };
  const better = (a: [number, number], b: [number, number]) =>
    a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  const byIssue = new Map<string, Hit>();
  docs.forEach((doc, d) => {
    const row = tf[d]!;
    const matched = row.filter((x) => x > 0).length;
    if (matched < need) return;
    let score = row.reduce((sum, x, k) => sum + idf[k]! * ((x * (K1 + 1)) / (x + K1)), 0);
    for (let k = 0; k + 1 < terms.length; k++) {
      if (row[k]! > 0 && row[k + 1]! > 0 && adjacent(doc, terms[k]!, terms[k + 1]!)) {
        score += PHRASE_BONUS * (idf[k]! + idf[k + 1]!);
      }
    }
    const hit = byIssue.get(doc.issueId) ?? {
      issueId: doc.issueId,
      score: 0,
      matched: 0,
      storyRank: [0, 0],
    };
    if (better([matched, score], [hit.matched, hit.score])) {
      hit.matched = matched;
      hit.score = score;
    }
    if (doc.story !== undefined && better([matched, score], hit.storyRank)) {
      hit.story = doc.story;
      hit.storyRank = [matched, score];
    }
    byIssue.set(doc.issueId, hit);
  });
  return [...byIssue.values()]
    .sort((a, b) => b.matched - a.matched || b.score - a.score)
    .map(({ issueId, score, story, matched }) => ({
      issueId,
      score,
      ...(story !== undefined ? { story } : {}),
      ...(matched < terms.length ? { partial: true as const } : {}),
    }));
}

/** A story's embedding, for search by meaning. */
export interface StoryVector {
  issueId: string;
  n: number;
  vector: Float32Array;
}

/**
 * Issues with a story close in meaning to the query, closest first: the cosine between the
 * query's embedding and each story's (both normalized, so a dot product), at least `floor`. An
 * issue scores its closest story, which is the one to show.
 */
export function rankByMeaning(
  query: ArrayLike<number>,
  stories: StoryVector[],
  floor = MEANING_FLOOR,
): SearchMatch[] {
  const byIssue = new Map<string, SearchMatch>();
  for (const s of stories) {
    let dot = 0;
    for (let i = 0; i < s.vector.length; i++) dot += query[i]! * s.vector[i]!;
    if (dot < floor) continue;
    const cur = byIssue.get(s.issueId);
    if (!cur || dot > cur.score)
      byIssue.set(s.issueId, { issueId: s.issueId, score: dot, story: s.n });
  }
  return [...byIssue.values()].sort((a, b) => b.score - a.score);
}

/** How a result matched: its words, its meaning, or both. */
export type MatchKind = "words" | "meaning" | "both";

export interface FusedMatch {
  issueId: string;
  /** The sum of 1 / (RRF_K + rank) over the lists it is in. */
  score: number;
  match: MatchKind;
  /** The story to show: the one its words matched, else the one closest in meaning. */
  story?: number;
}

/**
 * One list from both. Issues that hold the query's words come first, ordered by reciprocal rank
 * fusion: an issue scores 1 / (60 + rank) in each list it is in, so one high in both lists beats
 * one at the top of either, and the two lists' scores never have to be compared. Then the issues
 * only close in meaning, closest first: fused in among the others, a story just over the floor
 * ranked beside exact matches (on prod, "Size Limit measures bundle size" came second for "rate
 * limiting").
 */
export function fuse(byWords: SearchMatch[], byMeaning: SearchMatch[], k = RRF_K): FusedMatch[] {
  const out = new Map<string, FusedMatch>();
  const add = (list: SearchMatch[], match: "words" | "meaning") =>
    list.forEach((m, rank) => {
      const score = 1 / (k + rank + 1);
      const cur = out.get(m.issueId);
      if (cur) {
        cur.score += score;
        cur.match = "both";
        cur.story ??= m.story;
      } else {
        out.set(m.issueId, {
          issueId: m.issueId,
          score,
          match,
          ...(m.story !== undefined ? { story: m.story } : {}),
        });
      }
    });
  add(byWords, "words");
  add(byMeaning, "meaning");
  const all = [...out.values()].sort((a, b) => b.score - a.score);
  return [...all.filter((f) => f.match !== "meaning"), ...all.filter((f) => f.match === "meaning")];
}

/** What search reads: every issue and story as words, and every story's embedding. */
export interface SearchCorpus {
  docs: SearchDoc[];
  stories: StoryVector[];
}

/**
 * The whole search, words then meaning (#53). Without the query's embedding (search by meaning
 * unavailable), words alone, and only issues with every term.
 */
export function searchIssues(
  terms: string[],
  query: ArrayLike<number> | undefined,
  corpus: SearchCorpus,
): FusedMatch[] {
  const loose = query ? rankByMeaning(query, corpus.stories, LOOSE_FLOOR) : [];
  const near = new Set(loose.map((m) => m.issueId));
  const byWords = rankByWords(terms, corpus.docs).filter((m) => !m.partial || near.has(m.issueId));
  return fuse(
    byWords,
    loose.filter((m) => m.score >= MEANING_FLOOR),
  );
}

/** A text in runs, with the words a term matches marked, for highlighting a result. */
export function highlightRuns(text: string, terms: string[]): { text: string; hit: boolean }[] {
  const runs: { text: string; hit: boolean }[] = [];
  let last = 0;
  if (terms.length) {
    for (const m of text.matchAll(WORD)) {
      const w = stem(fold(m[0]));
      if (!terms.some((t) => matchWeight(t, w) > 0)) continue;
      if (m.index > last) runs.push({ text: text.slice(last, m.index), hit: false });
      runs.push({ text: m[0], hit: true });
      last = m.index + m[0].length;
    }
  }
  if (last < text.length) runs.push({ text: text.slice(last), hit: false });
  return runs;
}
