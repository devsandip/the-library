import { describe, expect, it } from "vitest";
import { storyText } from "../src/extract.js";

describe("storyText", () => {
  it("makes a web page's relative links whole, and leaves fragments and mail out (#128)", () => {
    const html =
      `<p>See <a href="/research/paper">the paper</a>, <a href="../post">the post</a>, ` +
      `<a href="#notes">the notes</a> and <a href="mailto:x@lab.test">mail us</a>.</p>`;
    expect(storyText(html, { base: "https://lab.test/news/item" }).links).toEqual([
      "https://lab.test/research/paper",
      "https://lab.test/post",
    ]);
    // A newsletter has no address to resolve against: its relative links stay unnumbered.
    expect(storyText(html).links).toEqual([]);
  });

  it("numbers each outside link once, after its text", () => {
    const { text, links } = storyText(
      `<p>OpenAI ships a model. <a href="https://example.com/a">Read more</a></p>` +
        `<p>Second story <a href="https://example.com/b">here</a>, ` +
        `and the first <a href="https://example.com/a">again</a>.</p>`,
    );
    expect(links).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(text).toContain("Read more [1]");
    expect(text).toContain("here [2]");
    expect(text).toContain("again [1]");
  });

  it("leaves housekeeping, image-only and non-web links unnumbered", () => {
    const { text, links } = storyText(
      `<p><a href="https://x.com/u">Unsubscribe</a> <a href="https://x.com/v">View in browser</a> ` +
        `<a href="https://x.com/i"><img src="https://x.com/a.png"></a> ` +
        `<a href="mailto:a@example.com">Email us</a> ` +
        `<a href="https://x.com/s">Nvidia shares fall</a></p>`,
    );
    expect(links).toEqual(["https://x.com/s"]);
    expect(text).toContain("Nvidia shares fall [1]");
    expect(text).toContain("Unsubscribe");
    expect(text).not.toContain("Unsubscribe [");
  });

  it("squeezes runs of preheader spaces", () => {
    expect(storyText(`<p>Preview\u00a0\u00a0\u00a0   text</p>`).text).toBe("Preview text");
  });
});
