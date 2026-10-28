/**
 * Weekly tune-up (#26, #158): Sandip's corrections counted per newsletter (stories he moved against
 * Jev's call, promos he pulled back out of Archived) and newsletter rules proposed from them, each
 * replayed over the newsletter's stored stories. Pure, so the API and the tests share one set of
 * rules. No model is called; Jev's question stays as Sandip left it (2026-10-17). Applying a rule
 * is the newsletter's "always" setting, set by Sandip.
 */
import { isUnsure, shelfFor, storyShelf } from "./shelves.js";
import type {
  AuditHeadline,
  SenderListItem,
  Shelf,
  StoryShelfSetBy,
  TuneupNewsletter,
  TuneupProposal,
  TuneupResponse,
} from "./types.js";

/** Stories moved to a shelf against Jev's call before a rule for it is proposed. */
export const TUNEUP_MIN_FIXES = 3;
/** The share of the newsletter's shelved stories already on that shelf, by Jev or by Sandip. */
export const TUNEUP_SHARE = 0.75;
/** Headlines shown of each kind, latest first. */
const HEADLINES = 3;

/** A story as the tune-up reads it: Jev's probability and who put it where it is. */
export interface TuneupStory {
  /** Its issue's id. */
  id: string;
  n: number;
  /** As written at the split; its issue's sender wins when the issue is known (senders re-key). */
  senderId: string;
  receivedAt: string;
  headline: string;
  learning?: number;
  shelf?: Shelf;
  shelfSetBy?: StoryShelfSetBy;
}

/** An issue as the tune-up reads it: its newsletter, and whether a rule archived it. */
export interface TuneupIssue {
  id: string;
  senderId: string;
  autoArchived?: "promo" | "old-news";
  archived: boolean;
}

/** What the tune-up is worked out from: everything stored, and the proposals put off. */
export interface TuneupData {
  senders: SenderListItem[];
  issues: TuneupIssue[];
  stories: TuneupStory[];
  /** Not now: a proposal's id, and how many of Sandip's moves it had then. */
  dismissed: Record<string, number>;
}

export const tuneupId = (senderId: string, shelf: Shelf) => `${senderId}.${shelf}`;

const other = (s: Shelf): Shelf => (s === "learning" ? "news" : "learning");

/** A story Sandip moved against Jev: Jev read it, and put it on the other shelf. */
const against = (s: TuneupStory) =>
  s.shelfSetBy === "sandip" && s.shelf !== undefined && s.learning !== undefined
    ? shelfFor(s.learning) !== s.shelf
    : false;

/**
 * "Always" this shelf for a newsletter without a setting, replayed over its stories: proposed when
 * Sandip moved at least 3 of them there against Jev, none to the other shelf, and most are there
 * already, so the rule finishes a pattern rather than overrules a mixed newsletter.
 */
export function propose(
  sender: SenderListItem,
  stories: TuneupStory[],
  shelf: Shelf,
): TuneupProposal | undefined {
  if (sender.muted || sender.shelf) return undefined;
  const shelved = stories
    .map((s) => ({ s, shelf: storyShelf(s).shelf }))
    .filter((x): x is { s: TuneupStory; shelf: Shelf } => x.shelf !== undefined);
  const fixed = shelved.filter((x) => x.shelf === shelf && against(x.s)).map((x) => x.s);
  const contrary = shelved.some((x) => x.shelf === other(shelf) && x.s.shelfSetBy === "sandip");
  const onShelf = shelved.filter((x) => x.shelf === shelf).length;
  if (fixed.length < TUNEUP_MIN_FIXES || contrary || onShelf < TUNEUP_SHARE * shelved.length) {
    return undefined;
  }
  const wouldMove = shelved.filter((x) => x.shelf !== shelf).map((x) => x.s);
  return {
    id: tuneupId(sender.senderId, shelf),
    senderId: sender.senderId,
    publication: sender.publication,
    shelf,
    fixes: fixed.length,
    moves: wouldMove.length,
    stories: shelved.length,
    onShelf,
    fixed: headlines(fixed),
    wouldMove: headlines(wouldMove),
  };
}

function headlines(stories: TuneupStory[]): AuditHeadline[] {
  return [...stories]
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.n - b.n)
    .slice(0, HEADLINES)
    .map((s) => ({ issueId: s.id, n: s.n, headline: s.headline }));
}

/** The corrections per newsletter, and the rules they point to that Sandip has not put off. */
export function tuneup(data: TuneupData): TuneupResponse {
  const senders = new Map(data.senders.map((s) => [s.senderId, s]));
  const senderOf = new Map(data.issues.map((i) => [i.id, i.senderId]));
  const stories = new Map<string, TuneupStory[]>();
  for (const s of data.stories) {
    const id = senderOf.get(s.id) ?? s.senderId;
    const list = stories.get(id);
    if (list) list.push(s);
    else stories.set(id, [s]);
  }

  const rows = new Map<string, TuneupNewsletter>();
  const row = (s: SenderListItem) => {
    const r = rows.get(s.senderId) ?? emptyRow(s);
    rows.set(s.senderId, r);
    return r;
  };
  for (const [id, list] of stories) {
    const sender = senders.get(id);
    if (!sender) continue;
    const r = row(sender);
    for (const s of list) {
      const shelf = storyShelf(s, sender.shelf).shelf;
      if (!shelf) continue;
      r.stories++;
      if (shelf === "learning") r.learning++;
      if (s.shelfSetBy !== "sandip") continue;
      r.moved++;
      if (!against(s)) continue;
      if (s.shelf === "learning") r.toLearning++;
      else r.toNews++;
      if (isUnsure(s.learning!)) r.unsure++;
    }
  }
  for (const i of data.issues) {
    const sender = senders.get(i.senderId);
    if (!sender || i.autoArchived !== "promo") continue;
    const r = row(sender);
    r.promos++;
    if (!i.archived) r.pulledBack++;
  }

  const proposals: TuneupProposal[] = [];
  let dismissed = 0;
  for (const [id, list] of stories) {
    const sender = senders.get(id);
    if (!sender) continue;
    for (const shelf of ["learning", "news"] as const) {
      const p = propose(sender, list, shelf);
      if (!p) continue;
      const put = data.dismissed[p.id];
      if (put !== undefined && p.fixes <= put) dismissed++;
      else proposals.push(p);
    }
  }
  proposals.sort(
    (a, b) => b.fixes - a.fixes || a.moves - b.moves || a.publication.localeCompare(b.publication),
  );

  const corrected = (r: TuneupNewsletter) => r.toLearning + r.toNews + r.pulledBack;
  const newsletters = [...rows.values()]
    .filter((r) => r.moved > 0 || r.pulledBack > 0)
    .sort(
      (a, b) =>
        corrected(b) - corrected(a) ||
        b.moved - a.moved ||
        a.publication.localeCompare(b.publication),
    );
  const totals = {
    stories: 0,
    moved: 0,
    toLearning: 0,
    toNews: 0,
    unsure: 0,
    promos: 0,
    pulledBack: 0,
  };
  for (const r of rows.values()) {
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r[k];
  }
  return { proposals, dismissed, newsletters, totals };
}

function emptyRow(s: SenderListItem): TuneupNewsletter {
  return {
    senderId: s.senderId,
    publication: s.publication,
    ...(s.shelf ? { shelf: s.shelf } : {}),
    stories: 0,
    learning: 0,
    moved: 0,
    toLearning: 0,
    toNews: 0,
    unsure: 0,
    promos: 0,
    pulledBack: 0,
  };
}
