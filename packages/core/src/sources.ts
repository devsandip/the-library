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
  /** Canonical readable identity shared by every matching address. */
  key: string;
  publication: string;
}

/** Merge several From addresses into one publication. */
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
  {
    match: /^bytebytego@substack\.com$/,
    key: "bytebytego@substack.com",
    publication: "ByteByteGo",
  },
];

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
 * senderKey is readable (alias key, or the address without any +tag). senderId is an opaque,
 * URL-safe hash of it, so "@" and "/" never travel through the two proxies in front of the API.
 */
export function senderIdentity(fromAddr: string, fromName: string) {
  const addr = fromAddr.toLowerCase().trim();
  const alias = SENDER_ALIASES.find((a) => a.match.test(addr));
  const senderKey = alias?.key ?? addr.replace(/\+[^@]*@/, "@");
  const senderId = `s${createHash("sha256").update(senderKey).digest("hex").slice(0, 12)}`;
  const publication = alias?.publication ?? (fromName.trim() || addr.split("@")[0] || addr);
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
