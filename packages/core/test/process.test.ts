import { describe, expect, it } from "vitest";
import { issueIndexAttributes } from "../src/keys.js";
import { processMessage, type ProcessedMessage } from "../src/process.js";
import { cleanLink, sanitizeNewsletterHtml } from "../src/sanitize.js";
import { classify, gmailQuery, senderIdentity } from "../src/sources.js";
import * as f from "./fixtures.js";

const run = (raw: Buffer, labelIds: string[] = [], snippet?: string) =>
  processMessage({ id: "m1", raw, labelIds, snippet, internalDate: "1791700000000" });

function newsletter(p: ProcessedMessage) {
  if (p.kind !== "newsletter") throw new Error(`expected newsletter, got filtered: ${p.reason}`);
  return p;
}

describe("classification", () => {
  it.each([
    ["github notifications", f.githubNoise, [f.LABEL_NEWSLETTERS], "github"],
    ["substack notes", f.substackNotes, [f.LABEL_MECO], "substack-notes"],
    ["weekly stack", f.substackWeeklyStack, [f.LABEL_MECO], "substack-weekly-stack"],
    ["stripe receipt", f.stripeReceipt, [f.LABEL_NEWSLETTERS], "receipt"],
    [
      "a verification code from an allowlisted sender",
      f.substackVerificationCode,
      ["INBOX"],
      "account",
    ],
    ["unlabeled random substack", f.randomSubstack, [], "not-a-source"],
    ["unlabeled platformer", f.platformerLabeled, ["INBOX"], "not-a-source"],
  ])("filters %s", async (_name, raw, labels, reason) => {
    const p = await run(raw, labels);
    expect(p.kind).toBe("filtered");
    expect(p.kind === "filtered" && p.reason).toBe(reason);
  });

  it("includes unlabeled allowlisted senders", async () => {
    for (const raw of [f.substackByteByteGo, f.lennyWildcard, f.pragmaticDeepDive]) {
      expect((await run(raw, ["INBOX"])).kind).toBe("newsletter");
    }
  });

  it("includes labeled newsletters from any sender", async () => {
    expect((await run(f.platformerLabeled, [f.LABEL_NEWSLETTERS])).kind).toBe("newsletter");
    expect((await run(f.tldrPlainText, [f.LABEL_MECO])).kind).toBe("newsletter");
  });
});

describe("account mail (#50)", () => {
  const subjectOf = (subject: string) =>
    classify({ fromAddr: "bytebytego@substack.com", subject, labelIds: [] });

  it.each([
    "643423 is your Substack verification code",
    "Your verification code is 123456",
    "Your one-time code: 482913",
    "123456 is your code",
    "Your login code for Medium",
    "Your Substack sign-in link",
    "🔑 Secure sign in link for Platformer",
    "Sign in to Substack",
    "Your magic link",
    "Please confirm your email address",
    "Verify your e-mail",
    "Activate your account",
    "Please Confirm Subscription",
    "Confirm your subscription to TLDR",
    "🙌 Complete your sign up to Platformer!",
    "You’re now subscribed",
    "Reset your password",
    "Password reset request",
    "Your password has been changed",
  ])("filters %s", (subject) => {
    expect(subjectOf(subject)).toEqual({ kind: "filtered", reason: "account" });
  });

  // Real subjects from the archive and close calls: issues write about codes and logins too.
  it.each([
    "You’re Probably Using Claude Code Wrong",
    "Claude Code on Autopilot: Schedule It Once and Walk Away",
    "Musk: Don't learn to code?",
    "Historic UN Security Council Briefing on AI",
    "The Saturday Read: Magical thinking",
    "Your security code review is missing these things",
    "Your login code is a mess",
    "How magic links work",
    "How password reset works",
    "2026 is your year to code",
    "Verify your assumptions",
    "Signing in with passkeys",
  ])("keeps %s", (subject) => {
    expect(subjectOf(subject)).toEqual({ kind: "newsletter" });
  });
});

describe("per-fixture metadata", () => {
  it.each([
    {
      name: "ByteByteGo (Substack)",
      raw: f.substackByteByteGo,
      labels: ["INBOX"],
      senderKey: "bytebytego@substack.com",
      publication: "ByteByteGo",
      view: "https://blog.bytebytego.com/p/ep182-discord?ref=x",
      unsub: "https://bytebytego.substack.com/action/disable_email?token=abc",
    },
    {
      name: "Platformer (Mailchimp-style)",
      raw: f.platformerLabeled,
      labels: [f.LABEL_NEWSLETTERS],
      senderKey: "casey@platformer.news",
      publication: "Platformer",
      view: "https://www.platformer.news/ai-search",
      unsub: "https://platformer.news/unsubscribe?id=42",
    },
    {
      name: "TLDR (plain text)",
      raw: f.tldrPlainText,
      labels: [f.LABEL_MECO],
      senderKey: "dan@tldrnewsletter.com#tldr-ai",
      publication: "TLDR AI",
      view: undefined,
      unsub: undefined,
    },
    {
      name: "Lenny (wildcard address)",
      raw: f.lennyWildcard,
      labels: [],
      senderKey: "lenny@substack.com",
      publication: "Lenny's Newsletter",
      view: "https://www.lennysnewsletter.com/p/how-i-ai-specs",
      unsub: undefined,
    },
    {
      name: "Pragmatic Engineer deepdive (+tag address)",
      raw: f.pragmaticDeepDive,
      labels: [],
      senderKey: "pragmaticengineer@substack.com",
      publication: "The Pragmatic Engineer",
      view: "https://newsletter.pragmaticengineer.com/p/stripe-apis",
      unsub: undefined,
    },
    {
      name: "Example Weekly (unknown sender)",
      raw: f.mixedImages,
      labels: [f.LABEL_NEWSLETTERS],
      senderKey: "hello@example-weekly.test",
      publication: "Example Weekly",
      view: "https://example-weekly.test/p/42",
      unsub: "https://example-weekly.test/u/abc",
    },
  ])("$name", async (c) => {
    const p = newsletter(await run(c.raw, c.labels));
    expect(p.senderKey).toBe(c.senderKey);
    expect(p.senderId).toMatch(/^s[0-9a-f]{12}$/);
    expect(p.senderId).toBe(senderIdentity(c.senderKey, "").senderId);
    expect(p.publication).toBe(c.publication);
    expect(p.viewOnlineUrl).toBe(c.view);
    expect(p.unsubscribeUrl).toBe(c.unsub);
    expect(p.receivedAt).toBe(new Date(1791700000000).toISOString());
  });

  it("uses Gmail's snippet when present", async () => {
    const p = newsletter(
      await run(f.substackByteByteGo, ["INBOX"], "Discord moved from Cassandra"),
    );
    expect(p.snippet).toBe("Discord moved from Cassandra");
  });
});

describe("sanitizing", () => {
  it("removes executable content and tracking pixels, keeps styles and real images", async () => {
    const { html } = newsletter(await run(f.substackByteByteGo, ["INBOX"]));
    expect(html).not.toMatch(/<script|alert\('x'\)|onclick|javascript:|<iframe|<form|<input/i);
    expect(html).not.toContain("eotrx.substackcdn.com/open");
    expect(html).toContain("diagram.png");
    expect(html).toContain(".post{font-family:Georgia}");
    expect(html).not.toContain("<title>");
    expect(html).toContain('href="https://blog.bytebytego.com/p/ep182-discord?ref=x"');
    expect(html).toMatch(/target="_blank"/);
    expect(html).toMatch(/rel="noopener noreferrer"/);
  });

  it("unwraps redirect wrappers and drops hidden images", async () => {
    const { html } = newsletter(await run(f.platformerLabeled, [f.LABEL_NEWSLETTERS]));
    expect(html).toContain('href="https://www.platformer.news/ai-search"');
    expect(html).not.toContain("track/open.php");
    expect(html).not.toContain("hero.jpg");
    expect(html).toContain("chart.png");
  });

  it("keeps images on ESP hosts but drops pixels, cid: and source-less images", async () => {
    const { html } = newsletter(await run(f.mixedImages, [f.LABEL_NEWSLETTERS]));
    expect(html).toContain("media.beehiiv.com/uploads/asset/file/hero.png");
    expect(html).toContain("gallery.mailchimp.com/abc/images/banner.jpg");
    expect(html).toContain("firebasestorage.googleapis.com");
    expect(html).not.toContain("email.example-weekly.test/o/");
    expect(html).not.toContain("sendgrid.net");
    expect(html).not.toContain("track/open.php");
    expect(html).not.toContain("cid:");
    expect(html).not.toContain("inline logo");
    expect(html).not.toContain("no source");
  });

  it("escapes plain-text issues inside <pre>", async () => {
    const p = newsletter(await run(f.tldrPlainText, [f.LABEL_MECO]));
    expect(p.html).toContain("<pre");
    expect(p.html).toContain("Headlines &amp; launches");
  });

  it("produces clean text and reading time", async () => {
    const p = newsletter(await run(f.substackByteByteGo, ["INBOX"]));
    expect(p.text).toContain("Discord moved from Cassandra to ScyllaDB.");
    expect(p.text).not.toContain("font-family");
    expect(p.text).not.toContain("EP182");
    expect(p.readMinutes).toBe(1);
  });

  it("strips event handlers on any tag", () => {
    expect(sanitizeNewsletterHtml('<p onmouseover="x()">hi</p>')).toBe("<p>hi</p>");
  });

  it("cleanLink leaves opaque and non-http links alone", () => {
    expect(cleanLink("https://substack.com/redirect/2/eyJ1cmwiOi")).toBe(
      "https://substack.com/redirect/2/eyJ1cmwiOi",
    );
    expect(cleanLink("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(cleanLink("not a url")).toBe("not a url");
  });
});

describe("sources", () => {
  it("senderIdentity strips plus tags and falls back to the local part", () => {
    expect(senderIdentity("news+daily@example.com", "Example Daily").senderKey).toBe(
      "news@example.com",
    );
    expect(senderIdentity("news@example.com", "").publication).toBe("news");
  });

  it("splits an address that sends several newsletters by From name", () => {
    const dev = senderIdentity("dan@tldrnewsletter.com", "TLDR Dev");
    const it_ = senderIdentity("Dan@TLDRnewsletter.com", " TLDR IT ");
    expect(dev).toMatchObject({
      senderKey: "dan@tldrnewsletter.com#tldr-dev",
      publication: "TLDR Dev",
    });
    expect(it_).toMatchObject({
      senderKey: "dan@tldrnewsletter.com#tldr-it",
      publication: "TLDR IT",
    });
    expect(dev.senderId).not.toBe(it_.senderId);
    // No name to split on: fall back to the address alone.
    expect(senderIdentity("dan@tldrnewsletter.com", "").senderKey).toBe("dan@tldrnewsletter.com");
  });

  it("names newsletters by address when the From name is a person or changes", () => {
    const cases: [string, string, string][] = [
      ["casey@platformer.news", "Casey Newton", "Platformer"],
      ["systemdesignone@substack.com", "Neo Kim", "System Design Newsletter"],
      ["algomaster@substack.com", "Ashish Pratap Singh", "AlgoMaster"],
      ["sayhello@producttalk.org", "Teresa Torres", "Product Talk"],
      ["optimizer@theverge.com", "Victoria Song, The Verge", "Optimizer"],
      ["installer@theverge.com", "Jay Peters from Installer", "Installer"],
      // The part before " from " is the newsletter here, so no general " from " rule.
      ["sdcourse@substack.com", "System Design Course from Systemdr", "System Design Course"],
    ];
    for (const [addr, name, publication] of cases) {
      expect(senderIdentity(addr, name).publication).toBe(publication);
      // Renaming keeps the sender: the key is still the address.
      expect(senderIdentity(addr, name).senderId).toBe(senderIdentity(addr, "").senderId);
    }
  });

  it("keeps one sender when the From name changes every issue", () => {
    const a = senderIdentity("thestepback@theverge.com", "Andrew J. Hawkins, The Verge");
    const b = senderIdentity("thestepback@theverge.com", "Terrence O'Brien, The Verge");
    expect(a.senderId).toBe(b.senderId);
    expect(a.publication).toBe("The Stepback");
  });

  it("merges +tag sections of one publication under its alias", () => {
    const deep = senderIdentity(
      "lewislin+deep-dives@substack.com",
      "Lewis C. Lin from Lewis C. Lin’s Newsletter",
    );
    const main = senderIdentity("lewislin@substack.com", "Lewis C. Lin");
    expect(deep.senderId).toBe(main.senderId);
    expect(deep.publication).toBe("Lewis C. Lin's Newsletter");
  });

  it("gmailQuery ORs labels and senders", () => {
    expect(gmailQuery(3)).toMatch(/^\{label:Newsletters .*from:substack\.com\} newer_than:3d$/);
  });
});

describe("issueIndexAttributes", () => {
  const base = { id: "m1", senderId: "sabc", receivedAt: "2026-10-01T00:00:00.000Z" };
  const sk = "2026-10-01T00:00:00.000Z#m1";

  it("unread: inbox, unread, sender", () => {
    const { set, remove } = issueIndexAttributes({ ...base, state: "unread" });
    expect(set).toEqual({
      gsi1pk: "INBOX",
      gsi1sk: sk,
      gsi2pk: "UNREAD",
      gsi2sk: sk,
      gsi3pk: "SENDER#sabc",
      gsi3sk: sk,
    });
    expect(remove).toEqual(["gsi4pk", "gsi4sk"]);
  });

  it("read and rated: leaves unread, joins rated", () => {
    const { set, remove } = issueIndexAttributes({
      ...base,
      state: "read",
      rating: 1,
      ratedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(set.gsi1pk).toBe("INBOX");
    expect(set.gsi4sk).toBe("2026-10-02T00:00:00.000Z#m1");
    expect(remove).toEqual(["gsi2pk", "gsi2sk"]);
  });

  it("archived: archive partition only plus sender", () => {
    const { set, remove } = issueIndexAttributes({ ...base, state: "archived" });
    expect(set.gsi1pk).toBe("ARCHIVE");
    expect(set.gsi3pk).toBe("SENDER#sabc");
    expect(remove).toEqual(["gsi2pk", "gsi2sk", "gsi4pk", "gsi4sk"]);
  });

  it("saved: its own partition by when it was saved, out of unread, read or not", () => {
    const savedAt = "2026-10-03T00:00:00.000Z";
    for (const state of ["unread", "read"] as const) {
      const { set } = issueIndexAttributes({ ...base, state, savedAt });
      expect(set.gsi1pk).toBe("INBOX");
      expect(set.gsi2pk).toBe("SAVED");
      expect(set.gsi2sk).toBe(`${savedAt}#m1`);
    }
  });

  it("filtered: in no index", () => {
    const { set, remove } = issueIndexAttributes({ ...base, state: "filtered" });
    expect(set).toEqual({});
    expect(remove).toHaveLength(8);
  });
});
