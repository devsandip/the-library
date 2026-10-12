import { describe, expect, it } from "vitest";
import { SPA_FUNCTION } from "../lib/web.js";

type Query = Record<string, { value: string; multiValue?: { value: string }[] }>;
interface Result {
  statusCode?: number;
  headers?: { location: { value: string } };
  uri?: string;
}

// The CloudFront function as CloudFront runs it: its source, then handler(event).
const handler = new Function(`${SPA_FUNCTION}; return handler;`)() as (event: unknown) => Result;
const run = (uri: string, querystring: Query = {}) => handler({ request: { uri, querystring } });
const location = (uri: string, querystring?: Query) => {
  const res = run(uri, querystring);
  expect(res.statusCode).toBe(301);
  return res.headers?.location.value;
};

describe("the SPA routing function", () => {
  it("sends the root and the bare path to /nutgraf/", () => {
    expect(location("/")).toBe("/nutgraf/");
    expect(location("/nutgraf")).toBe("/nutgraf/");
  });

  it("moves every /thelibrary URL to the same place under /nutgraf", () => {
    expect(location("/thelibrary")).toBe("/nutgraf/");
    expect(location("/thelibrary/")).toBe("/nutgraf/");
    expect(location("/thelibrary/today")).toBe("/nutgraf/today");
    expect(location("/thelibrary/issue/abc/story/2/timeline")).toBe(
      "/nutgraf/issue/abc/story/2/timeline",
    );
    expect(location("/thelibrary/about.html")).toBe("/nutgraf/about.html");
  });

  it("keeps the query string as it arrived, repeated keys included", () => {
    expect(
      location("/thelibrary/browse", {
        kind: { value: "news" },
        topic: { value: "ai-llms,startups-business" },
      }),
    ).toBe("/nutgraf/browse?kind=news&topic=ai-llms,startups-business");
    expect(location("/thelibrary/library/search", { q: { value: "how%20discord%20stores" } })).toBe(
      "/nutgraf/library/search?q=how%20discord%20stores",
    );
    expect(
      location("/thelibrary/x", {
        a: { value: "1", multiValue: [{ value: "1" }, { value: "2" }] },
      }),
    ).toBe("/nutgraf/x?a=1&a=2");
  });

  it("serves the shell for app paths and passes real files through", () => {
    expect(run("/nutgraf/browse").uri).toBe("/nutgraf/index.html");
    expect(run("/nutgraf/senders/a.b").uri).toBe("/nutgraf/index.html");
    for (const file of [
      "/nutgraf/assets/index-abc.js",
      "/nutgraf/icons/favicon.svg",
      "/nutgraf/manifest.json",
      "/nutgraf/config.json",
      "/nutgraf/privacy.html",
    ]) {
      expect(run(file).uri).toBe(file);
    }
  });

  it("knows nothing outside its two paths", () => {
    expect(run("/elsewhere").statusCode).toBe(404);
    expect(run("/thelibraryx").statusCode).toBe(404);
  });
});
