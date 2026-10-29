/**
 * Everything Nutgraf keeps for a reader, as one JSON file (#219): what they set and did, not the
 * newsletters' own text, which is in their mail. Imported by the web app too.
 */
import type { StoredFollow } from "./follow.js";
import type { ReaderSettings } from "./settings.js";
import type { Highlight, Prediction } from "./types.js";
import type { DayUsage } from "./usage.js";

export interface ExportedIssue {
  id: string;
  publication: string;
  subject: string;
  receivedAt: string;
  state: string;
  rating?: number;
  ratedAt?: string;
  savedAt?: string;
  summary?: string;
  topic?: string;
  shelf?: string;
  viewOnlineUrl?: string;
}

export interface ExportedNewsletter {
  senderId: string;
  publication: string;
  muted?: boolean;
  mustRead?: boolean;
  shelf?: string;
  up?: number;
  down?: number;
  issueCount?: number;
}

export interface ReaderExport {
  /** What the file is, for whoever opens it later. */
  about: string;
  exportedAt: string;
  reader?: string;
  settings: Omit<ReaderSettings, "limits">;
  newsletters: ExportedNewsletter[];
  issues: ExportedIssue[];
  highlights: Highlight[];
  predictions: (Prediction & { status: string; setBy?: string; why?: string })[];
  following: StoredFollow[];
  /** Every issue opened or peeked at, newest first. */
  history: { id: string; at: string; via: "open" | "peek" }[];
  usage: DayUsage[];
}

export const EXPORT_ABOUT =
  "Everything Nutgraf keeps for you: your settings, newsletters, issues (with what you did to " +
  "them), highlights, verdicts, followed stories, reading history and model use. The " +
  "newsletters' own text is not here; it is in your mail.";

/** The file's name: `nutgraf-export-<day>.json`. */
export const exportFileName = (day: string) => `nutgraf-export-${day}.json`;
