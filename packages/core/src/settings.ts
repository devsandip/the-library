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
  /**
   * The reader's own daily limits, where an operator set them (#209); the defaults otherwise. Not
   * a reader's to change: `PATCH /settings` refuses it.
   */
  limits?: Record<string, number>;
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

/** The settings as the API answers them: and whether the reader has been through onboarding. */
export interface SettingsAnswer extends ReaderSettings {
  /** False for a new reader on reader keys, who sees onboarding first (#221). */
  onboarded: boolean;
}

/** What onboarding offers to pick from (#221): broad, so most readers find theirs. */
export const SUGGESTED_INTERESTS: Interest[] = [
  { name: "AI", text: "AI: models, products, research and the AI industry." },
  {
    name: "the tech industry",
    text: "The tech industry: big tech companies, platforms and regulation.",
  },
  {
    name: "startups",
    text: "Startups: founders, fundraising, venture capital and building a company.",
  },
  {
    name: "product",
    text: "Product: strategy, discovery, design and the craft of building products.",
  },
  { name: "engineering", text: "Engineering: software architecture, systems and how teams build." },
  { name: "business", text: "Business: companies, strategy, deals and how industries change." },
  { name: "markets", text: "Markets and finance: investing, the economy and what moves prices." },
  { name: "politics", text: "Politics and policy: governments, elections, law and regulation." },
  { name: "science", text: "Science: research, discoveries and how the world works." },
  { name: "climate", text: "Climate and energy: emissions, energy transition and policy." },
  { name: "health", text: "Health and medicine: research, care, fitness and wellbeing." },
  { name: "culture", text: "Culture: books, film, music, the internet and how people live." },
];

/** The line every prompt uses, made from a new reader's interests (#221). */
export function aboutFrom(interests: Interest[]): string {
  const names = interests.map((i) => i.name);
  if (!names.length) return "The reader reads newsletters on many subjects.";
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `The reader is interested in ${list}.`;
}

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
