/** Synthetic emails modeled on real newsletter structure. No real mail content. */

interface EmlOptions {
  from: string;
  subject: string;
  html?: string;
  text?: string;
  listUnsubscribe?: string;
  date?: string;
}

export function eml(o: EmlOptions): Buffer {
  const boundary = "b1_testboundary";
  const headers = [
    `From: ${o.from}`,
    `To: dev.sandip@gmail.com`,
    `Subject: ${o.subject}`,
    `Date: ${o.date ?? "Thu, 08 Oct 2026 06:30:00 +0000"}`,
    `Message-ID: <${Math.random().toString(36).slice(2)}@example.test>`,
    `MIME-Version: 1.0`,
    ...(o.listUnsubscribe ? [`List-Unsubscribe: ${o.listUnsubscribe}`] : []),
  ];
  if (o.html && o.text) {
    return Buffer.from(
      [
        ...headers,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        o.text,
        `--${boundary}`,
        "Content-Type: text/html; charset=utf-8",
        "",
        o.html,
        `--${boundary}--`,
        "",
      ].join("\r\n"),
    );
  }
  const [type, body] = o.html ? ["text/html", o.html] : ["text/plain", o.text ?? ""];
  return Buffer.from(
    [...headers, `Content-Type: ${type}; charset=utf-8`, "", body, ""].join("\r\n"),
  );
}

export const LABEL_NEWSLETTERS = "Label_244609042207730416";
export const LABEL_MECO = "Label_18";

export const substackByteByteGo = eml({
  from: '"ByteByteGo" <bytebytego@substack.com>',
  subject: "EP182: How Discord stores trillions of messages",
  listUnsubscribe:
    "<https://bytebytego.substack.com/action/disable_email?token=abc>, <mailto:unsubscribe@substack.com>",
  html: `<html><head><title>EP182</title><style>.post{font-family:Georgia}</style>
<script>alert('x')</script></head>
<body>
<div class="post" onclick="steal()">
<h1>How Discord stores trillions of messages</h1>
<p>Discord moved from Cassandra to ScyllaDB. <a href="https://blog.bytebytego.com/p/ep182-discord?utm_source=substack&amp;utm_medium=email&amp;ref=x">Read the post</a></p>
<p><a href="javascript:alert(1)">bad link</a></p>
<img src="https://substackcdn.com/image/fetch/w_1200/diagram.png" width="600" alt="diagram">
<img src="https://eotrx.substackcdn.com/open?token=xyz" width="1" height="1" alt="">
<iframe src="https://evil.example/frame"></iframe>
<form action="https://evil.example"><input name="q"></form>
</div>
</body></html>`,
});

export const platformerLabeled = eml({
  from: '"Casey Newton" <casey@platformer.news>',
  subject: "The AI search wars heat up",
  listUnsubscribe: "<mailto:unsub@platformer.news>",
  html: `<table width="600"><tr><td>
<a href="https://platformer.us1.list-manage.com/track/click?u=1&amp;url=https%3A%2F%2Fwww.platformer.news%2Fai-search%3Futm_campaign%3Dx">View in browser</a>
<p>Today: the AI search wars heat up, and what it means for publishers.</p>
<img src="https://platformer.us1.list-manage.com/track/open.php?u=1" width="1" height="1">
<img src="https://cdn.platformer.news/hero.jpg" style="display:none" alt="hidden">
<img src="https://cdn.platformer.news/chart.png" alt="chart">
<p><a href="https://www.platformer.news/account">Manage subscription</a> | <a href="https://platformer.news/unsubscribe?id=42">Unsubscribe</a></p>
</td></tr></table>`,
});

export const githubNoise = eml({
  from: '"GitHub" <notifications@github.com>',
  subject: "[devsandip/wndrist] PR #42 merged",
  text: "Merged.",
});

export const substackNotes = eml({
  from: '"Substack" <no-reply@substack.com>',
  subject: "3 new notes from writers you follow",
  html: "<p>notes</p>",
});

export const substackWeeklyStack = eml({
  from: '"The Weekly Stack" <weeklystack@substack.com>',
  subject: "The Weekly Stack: top posts this week",
  html: "<p>stack</p>",
});

/** Account mail from a newsletter's own address, which the allowlist lets in (#50). */
export const substackVerificationCode = eml({
  from: '"ByteByteGo" <bytebytego@substack.com>',
  subject: "643423 is your Substack verification code",
  listUnsubscribe: "<https://bytebytego.substack.com/action/disable_email?token=abc>",
  html: "<p>Here's your verification code: 643423. It expires in 10 minutes.</p>",
});

export const stripeReceipt = eml({
  from: '"The Ken" <receipts@stripe.com>',
  subject: "Your receipt from The Ken #1234-5678",
  html: "<p>Amount paid: INR 2,999</p>",
});

export const tldrPlainText = eml({
  from: '"TLDR AI" <dan@tldrnewsletter.com>',
  subject: "OpenAI ships agents, Anthropic research <script>",
  text: "Headlines & launches\n\nModel news one\nModel news two\n\nhttps://tldr.tech/ai",
});

export const lennyWildcard = eml({
  from: '"Lenny\'s Podcast" <lenny+how-i-ai@substack.com>',
  subject: "How I AI: building product specs with Claude",
  html: `<p>This week on How I AI.</p><p><a href="https://www.lennysnewsletter.com/p/how-i-ai-specs">Read on Substack</a></p>`,
});

export const randomSubstack = eml({
  from: '"Some Writer" <somewriter@substack.com>',
  subject: "My cat's new hobby",
  html: "<p>meow</p>",
});

export const pragmaticDeepDive = eml({
  from: '"The Pragmatic Engineer" <pragmaticengineer+deepdives@substack.com>',
  subject: "Deepdive: How Stripe builds APIs",
  html: `<p>Deepdive.</p><p><a href="https://newsletter.pragmaticengineer.com/p/stripe-apis">Open in app</a></p>`,
});

/** Real images on ESP-owned hosts must survive; pixels and cid: images must not. */
export const mixedImages = eml({
  from: '"Example Weekly" <hello@example-weekly.test>',
  subject: "Images from everywhere",
  listUnsubscribe: "<https://example-weekly.test/u/abc>",
  html: `<p>Read online: <a href="https://example-weekly.test/p/42?utm_medium=email">View online</a></p>
<img src="https://media.beehiiv.com/uploads/asset/file/hero.png" alt="beehiiv hero">
<img src="https://gallery.mailchimp.com/abc/images/banner.jpg" alt="mailchimp banner">
<img src="https://firebasestorage.googleapis.com/v0/b/app/o/chart.png?alt=media" alt="firebase chart">
<img src="https://email.example-weekly.test/o/eyJhbGciOi" alt="">
<img src="https://ct.sendgrid.net/wf/open?upn=xyz" alt="">
<img src="https://example-weekly.test/track/open.php?u=1" alt="">
<img src="cid:logo@example" alt="inline logo">
<img alt="no source">`,
});
