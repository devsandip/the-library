/**
 * Which Gmail messages are newsletters, and how to name their senders.
 * Edit this file to add a source, a noise rule, or a sender alias.
 */
import { createHash } from "node:crypto";

export const NEWSLETTER_LABEL_IDS = [
  "Label_244609042207730416", // Newsletters
  "Label_18", // Meco_97675919-0d09-4077-a165-9d5569fa1957
] as const;

const NEWSLETTER_LABEL_NAMES = ["Newsletters", "Meco_97675919-0d09-4077-a165-9d5569fa1957"];

/** Senders included even when unlabeled. */
const ALLOWED_FROM: RegExp[] = [
  /^bytebytego@substack\.com$/,
  /^pragmaticengineer(\+deepdives)?@substack\.com$/,
  /^lenny.*@substack\.com$/,
];

/**
 * Gmail search query for one ingest run. `from:substack.com` is broad on purpose
 * (Lenny's address is a wildcard); classify() narrows it.
 */
export function gmailQuery(newerThanDays: number): string {
  const labels = NEWSLETTER_LABEL_NAMES.map((n) => `label:${n}`);
  const froms = [
    "from:bytebytego@substack.com",
    "from:pragmaticengineer@substack.com",
    "from:pragmaticengineer+deepdives@substack.com",
    "from:substack.com",
  ];
  return `{${[...labels, ...froms].join(" ")}} newer_than:${newerThanDays}d`;
}

interface NoiseRule {
  reason: string;
  from?: RegExp;
  subject?: RegExp;
}

const NOISE_RULES: NoiseRule[] = [
  { reason: "github", from: /@github\.com$/ },
  { reason: "substack-notes", from: /@substack\.com$/, subject: /\bnew notes?\b/i },
  { reason: "substack-weekly-stack", subject: /\bweekly stack\b/i },
  {
    reason: "substack-platform",
    from: /^(no-reply|noreply|support|info)@substack\.com$/,
  },
  {
    reason: "receipt",
    subject:
      /\b(receipt|invoice|payment (received|confirmation|failed)|your order|order confirmation|subscription (confirmed|renewed|renewal))\b/i,
  },
  {
    reason: "receipt",
    from: /@(stripe\.com|paddle\.com|email\.apple\.com|razorpay\.com|gumroad\.com)$/,
  },
];

export type Classification =
  { kind: "newsletter" } | { kind: "filtered"; reason: string } | { kind: "ignore" };

export function classify(msg: {
  fromAddr: string;
  subject: string;
  labelIds: readonly string[];
}): Classification {
  const from = msg.fromAddr.toLowerCase();
  const labeled = msg.labelIds.some((l) => (NEWSLETTER_LABEL_IDS as readonly string[]).includes(l));
  const allowed = ALLOWED_FROM.some((re) => re.test(from));
  if (!labeled && !allowed) return { kind: "ignore" };

  for (const rule of NOISE_RULES) {
    const fromOk = !rule.from || rule.from.test(from);
    const subjectOk = !rule.subject || rule.subject.test(msg.subject);
    if (fromOk && subjectOk) return { kind: "filtered", reason: rule.reason };
  }
  return { kind: "newsletter" };
}

interface SenderAlias {
  match: RegExp;
  /** Canonical readable identity shared by every matching address. Default: the address without any +tag. */
  key?: string;
  publication: string;
}

/**
 * Publication names by address. Merges several addresses into one newsletter, and names
 * newsletters whose From name is a person or changes from issue to issue. After changing this,
 * deploy and run `pnpm rebuild-senders` so stored issues follow.
 */
const SENDER_ALIASES: SenderAlias[] = [
  {
    match: /^pragmaticengineer(\+.*)?@substack\.com$/,
    key: "pragmaticengineer@substack.com",
    publication: "The Pragmatic Engineer",
  },
  {
    match: /^lenny.*@substack\.com$/,
    key: "lenny@substack.com",
    publication: "Lenny's Newsletter",
  },
  { match: /^bytebytego@substack\.com$/, publication: "ByteByteGo" },
  { match: /^casey@platformer\.news$/, publication: "Platformer" },
  { match: /^systemdesignone@substack\.com$/, publication: "System Design Newsletter" },
  { match: /^algomaster@substack\.com$/, publication: "AlgoMaster" },
  { match: /^sayhello@producttalk\.org$/, publication: "Product Talk" },
  { match: /^lewislin(\+.*)?@substack\.com$/, publication: "Lewis C. Lin's Newsletter" },
  { match: /^sdcourse(\+.*)?@substack\.com$/, publication: "System Design Course" },
  { match: /^systemdr(\+.*)?@substack\.com$/, publication: "System Design Roadmap" },
  { match: /^subscriptions@theverge\.com$/, publication: "The Verge" },
  { match: /^optimizer@theverge\.com$/, publication: "Optimizer" },
  { match: /^installer@theverge\.com$/, publication: "Installer" },
  { match: /^thestepback@theverge\.com$/, publication: "The Stepback" },
  { match: /^email@theatlantic\.com$/, publication: "The Atlantic" },
];

/**
 * Addresses that send several newsletters, told apart only by the From name (every TLDR edition
 * comes from one address). Each name becomes its own sender.
 */
const SPLIT_BY_NAME: RegExp[] = [/^dan@tldrnewsletter\.com$/, /^snigdha@thejuggernaut\.com$/];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Keep list from the PRD. Matched against the From display name and address. */
const KEEP_LIST: RegExp[] = [
  /\bthe ken\b/i,
  /platformer/i,
  /system design/i,
  /neo kim/i,
  /algomaster/i,
  /bytebytego/i,
  /pragmatic ?engineer/i,
  /lenny/i,
  /product talk|teresa torres/i,
  /itamar gilad/i,
  /lewis c\.? lin/i,
  /business insider/i,
  /\btldr\b/i,
  /economist/i,
  /washington ?post/i,
];

/**
 * senderKey is readable (alias key, or the address without any +tag, plus "#<name>" for addresses
 * split by From name). senderId is an opaque, URL-safe hash of it, so "@" and "/" never travel
 * through the two proxies in front of the API.
 */
export function senderIdentity(fromAddr: string, fromName: string) {
  const addr = fromAddr.toLowerCase().trim();
  const name = fromName.trim();
  const alias = SENDER_ALIASES.find((a) => a.match.test(addr));
  const base = alias?.key ?? addr.replace(/\+[^@]*@/, "@");
  const split = !alias && name !== "" && SPLIT_BY_NAME.some((re) => re.test(addr));
  const senderKey = split ? `${base}#${slug(name) || name.toLowerCase()}` : base;
  const senderId = `s${createHash("sha256").update(senderKey).digest("hex").slice(0, 12)}`;
  const publication = alias?.publication ?? (name || addr.split("@")[0] || addr);
  const onKeepList = KEEP_LIST.some(
    (re) => re.test(fromName) || re.test(addr) || re.test(publication),
  );
  return { senderId, senderKey, publication, onKeepList };
}

/**
 * Open-tracking pixels. Hosts here serve nothing but tracking; paths catch trackers on mixed
 * hosts. Keep this narrow: ESP domains like beehiiv.com or mailchimp.com also host real images.
 */
export const TRACKER_HOSTS: RegExp[] = [
  /(^|\.)list-manage\.com$/,
  /(^|\.)sendgrid\.net$/,
  /(^|\.)mailgun\.org$/,
  /(^|\.)convertkit-mail\d*\.com$/,
  /^track\./,
  /(^|\.)pixel\./,
];
export const TRACKER_PATHS: RegExp[] = [/\/(track\/|wf\/)?open(\.php|\.gif|\.png)?(\/|$)/i];

/** Redirect wrappers whose destination is recoverable from a query parameter. */
export const REDIRECT_PARAMS: { host: RegExp; param: string }[] = [
  { host: /(^|\.)list-manage\.com$/, param: "url" },
  { host: /(^|\.)sendgrid\.net$/, param: "url" },
  { host: /(^|\.)convertkit-mail\d*\.com$/, param: "url" },
  { host: /(^|\.)ck\.page$/, param: "url" },
  { host: /(^|\.)beehiiv\.com$/, param: "url" },
  { host: /(^|\.)mailchi\.mp$/, param: "url" },
  { host: /^(www\.)?google\.com$/, param: "q" },
];
