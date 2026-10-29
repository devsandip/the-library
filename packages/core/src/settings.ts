/**
 * A reader's settings (#184): their time zone, what they care about and how Claude knows them.
 * A reader without settings gets today's values, the owner's, so nothing changed for Sandip when
 * readers got settings (milestone 12 of `docs/features/multi-reader.md`). Imported by the web app
 * too, so it stays free of dependencies.
 */
import { READER } from "./claude.js";
import { READER_TIME_ZONE } from "./days.js";
import { INTERESTS } from "./rank.js";

/** Something the reader cares about: a name for ranking reasons, a sentence to embed. */
export interface Interest {
  name: string;
  text: string;
}

export interface ReaderSettings {
  /** An IANA time zone: the reader's days, the digest's day and every date shown. */
  timeZone: string;
  /** What the reader cares about; seeds the ranking's taste profile. */
  interests: Interest[];
  /** Who the reader is, as every prompt tells Claude. */
  about: string;
  /** What Learning means to the reader (#187): what Jev asks a story to be, to shelve it there. */
  learning: string;
}

/**
 * What Learning means to Sandip (2026-10-12): craft, not shelf life. How to use a tool, or how it
 * works, is Learning; that it launched is News, even when it is a new kind of tool (2026-10-17).
 * Rewordings scored no better; see docs/features/story-shelves.md.
 */
export const CRAFT =
  "Builds the reader's craft: product management, system design, software engineering, " +
  "how to build with AI, startup and business strategy. How-tos, explanations of how a system " +
  "works, case studies of how a team built or decided something, frameworks, and interviews " +
  "about doing the work.";

/** What Learning means to a new reader until they say (#187): a skill or an understanding. */
export const PLAIN_LEARNING =
  "Teaches the reader a skill or how something works: how-tos, explanations, case studies of " +
  "how something was built or decided, frameworks, and interviews about doing the work.";

/** Today's values: a reader without settings gets these. */
export const DEFAULT_SETTINGS: ReaderSettings = {
  timeZone: READER_TIME_ZONE,
  interests: INTERESTS.map((i) => ({ ...i })),
  about: READER,
  learning: CRAFT,
};

export const SETTINGS_LIMITS = {
  interests: 10,
  name: 40,
  text: 300,
  about: 600,
  learning: 600,
} as const;

/** A time zone the runtime knows by name, such as "America/New_York" or "UTC". */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(tz)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  return t && t.length <= max ? t : undefined;
};

/** A settings change checked: the fields it sets, cleaned, or what is wrong with it. */
export function checkSettingsPatch(
  body: unknown,
): { patch: Partial<ReaderSettings> } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "not an object" };
  const b = body as Record<string, unknown>;
  const patch: Partial<ReaderSettings> = {};
  for (const key of Object.keys(b)) {
    if (key !== "timeZone" && key !== "interests" && key !== "about" && key !== "learning") {
      return { error: `unknown setting: ${key}` };
    }
  }
  if ("timeZone" in b) {
    if (!isTimeZone(b.timeZone)) return { error: "timeZone must be a time zone name" };
    patch.timeZone = b.timeZone;
  }
  if ("interests" in b) {
    const list = b.interests;
    const { interests: most, name: nameMax, text: textMax } = SETTINGS_LIMITS;
    if (!Array.isArray(list) || list.length < 1 || list.length > most) {
      return { error: `interests must be 1 to ${most}` };
    }
    const interests: Interest[] = [];
    for (const i of list as unknown[]) {
      const o = (i ?? {}) as Record<string, unknown>;
      const name = text(o.name, nameMax);
      const sentence = text(o.text, textMax);
      if (!name || !sentence) {
        return { error: `each interest needs a name (${nameMax}) and a text (${textMax})` };
      }
      interests.push({ name, text: sentence });
    }
    patch.interests = interests;
  }
  if ("about" in b) {
    const about = text(b.about, SETTINGS_LIMITS.about);
    if (!about) return { error: `about must be 1 to ${SETTINGS_LIMITS.about} characters` };
    patch.about = about;
  }
  if ("learning" in b) {
    const learning = text(b.learning, SETTINGS_LIMITS.learning);
    if (!learning) return { error: `learning must be 1 to ${SETTINGS_LIMITS.learning} characters` };
    patch.learning = learning;
  }
  if (!Object.keys(patch).length) return { error: "nothing to change" };
  return { patch };
}
