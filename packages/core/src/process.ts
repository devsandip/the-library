import { simpleParser } from "mailparser";
import { classify, senderIdentity } from "./sources.js";
import { cleanLink, sanitizeNewsletterHtml } from "./sanitize.js";
import {
  anchors,
  findUnsubscribeUrl,
  findViewOnlineUrl,
  htmlToCleanText,
  readMinutes,
  wordCount,
} from "./extract.js";

export interface GmailMessageInput {
  id: string;
  raw: Buffer;
  labelIds: string[];
  snippet?: string;
  internalDate?: string; // ms since epoch, as Gmail returns it
}

interface Common {
  id: string;
  fromAddr: string;
  fromName: string;
  subject: string;
  receivedAt: string;
  labelIds: string[];
}

export type ProcessedMessage =
  | (Common & { kind: "filtered"; reason: string })
  | (Common & {
      kind: "newsletter";
      senderId: string;
      senderKey: string;
      publication: string;
      snippet: string;
      html: string;
      text: string;
      wordCount: number;
      readMinutes: number;
      viewOnlineUrl?: string;
      unsubscribeUrl?: string;
    });

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function headerLine(
  headerLines: readonly { key: string; line: string }[],
  key: string,
): string | undefined {
  const line = headerLines.find((h) => h.key === key)?.line;
  return line
    ?.slice(line.indexOf(":") + 1)
    .replace(/\s+/g, " ")
    .trim();
}

export async function processMessage(msg: GmailMessageInput): Promise<ProcessedMessage> {
  const parsed = await simpleParser(msg.raw, { skipImageLinks: true, skipTextToHtml: false });
  const from = parsed.from?.value[0];
  const fromAddr = (from?.address ?? "").toLowerCase();
  const fromName = from?.name ?? "";
  const subject = parsed.subject ?? "(no subject)";
  const receivedAt = new Date(
    msg.internalDate ? Number(msg.internalDate) : (parsed.date?.getTime() ?? Date.now()),
  ).toISOString();
  const common: Common = {
    id: msg.id,
    fromAddr,
    fromName,
    subject,
    receivedAt,
    labelIds: msg.labelIds,
  };

  const cls = classify({ fromAddr, subject, labelIds: msg.labelIds });
  if (cls.kind === "ignore") return { ...common, kind: "filtered", reason: "not-a-source" };
  if (cls.kind === "filtered") return { ...common, kind: "filtered", reason: cls.reason };

  const rawHtml =
    typeof parsed.html === "string" && parsed.html.trim()
      ? parsed.html
      : `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(parsed.text ?? "")}</pre>`;

  const links = anchors(rawHtml);
  const html = sanitizeNewsletterHtml(rawHtml);
  const text = htmlToCleanText(html);
  const words = wordCount(text);
  const { senderId, senderKey, publication } = senderIdentity(fromAddr, fromName);

  // Find links in the original HTML (sanitizing rewrites them), then clean the view-online one.
  const viewOnlineRaw = findViewOnlineUrl(links, { substack: fromAddr.endsWith("@substack.com") });
  const viewOnlineUrl = viewOnlineRaw ? cleanLink(viewOnlineRaw) : undefined;
  const unsubscribeUrl = findUnsubscribeUrl(
    headerLine(parsed.headerLines, "list-unsubscribe"),
    links,
  );

  const snippet = (msg.snippet?.trim() || text.slice(0, 200)).replace(/\s+/g, " ").trim();

  return {
    ...common,
    kind: "newsletter",
    senderId,
    senderKey,
    publication,
    snippet,
    html,
    text,
    wordCount: words,
    readMinutes: readMinutes(words),
    viewOnlineUrl,
    unsubscribeUrl,
  };
}
