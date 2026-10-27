import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchPage, isPublicAddress, PAGE_MAX_BYTES, PageError } from "../src/page.js";

describe("isPublicAddress", () => {
  it("lets public addresses through", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::6810:84e5", "2001:4860:4860::8888"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it("refuses private, loopback, link-local, shared, documentation and reserved addresses", () => {
    for (const ip of [
      "10.1.2.3",
      "127.0.0.1",
      "169.254.169.254", // the cloud metadata service
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "192.0.2.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
      "2002:c0a8:101::1", // 6to4 around a private v4
      "64:ff9b::a00:1", // NAT64
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "not an address",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
});

describe("fetchPage", () => {
  let server: Server;
  let base: string;
  const big = "x".repeat(PAGE_MAX_BYTES + 10);
  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? "/";
      if (path === "/article") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body><p>The page.</p></body></html>");
      } else if (path === "/gzip") {
        res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
        res.end(gzipSync("Compressed text."));
      } else if (path.startsWith("/hop/")) {
        const left = Number(path.slice(5));
        res.writeHead(302, { location: left > 0 ? `/hop/${left - 1}` : "/article" });
        res.end();
      } else if (path === "/to-private") {
        res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
      } else if (path === "/big") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(big);
      } else if (path === "/pdf") {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end("%PDF");
      } else {
        res.writeHead(404, { "content-type": "text/html" });
        res.end("no");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // The test server is on loopback on its own port; these let it through on purpose.
  const local = () => ({
    allowed: (ip: string) => ip === "127.0.0.1",
    ports: ["", new URL(base).port],
  });
  const read = (path: string) => fetchPage(`${base}${path}`, local());
  const fails = async (p: Promise<unknown>, message: RegExp) => {
    const err = await p.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PageError);
    expect((err as Error).message).toMatch(message);
  };

  it("refuses this very server on its own rules: a loopback address, and a non-web port", async () => {
    await fails(fetchPage(`${base}/article`), /web port|public/);
    await fails(fetchPage("http://127.0.0.1/article"), /public/);
    await fails(fetchPage("http://[::1]/article"), /public/);
    await fails(fetchPage("http://localhost/article"), /public|reached/);
  });

  it("refuses links that are not web pages", async () => {
    await fails(fetchPage("ftp://example.com/x"), /not a web page/);
    await fails(fetchPage("mailto:a@b.c"), /not a web page/);
    await fails(fetchPage("http://user:pass@example.com/"), /password/);
    await fails(fetchPage("not a link"), /not a web address/);
  });

  it("reads HTML and plain text, decompressed", async () => {
    const page = await read("/article");
    expect(page).toMatchObject({ url: `${base}/article`, contentType: "text/html; charset=utf-8" });
    expect(page.body).toContain("The page.");
    expect((await read("/gzip")).body).toBe("Compressed text.");
  });

  it("follows up to three redirects, each checked, and no more", async () => {
    expect((await read("/hop/2")).url).toBe(`${base}/article`);
    await fails(read("/hop/3"), /redirects too many/);
    // A redirect to the metadata service is refused like a link to it.
    await fails(read("/to-private"), /public/);
  });

  it("stops at the size limit, and reads only web pages that answer 200", async () => {
    await fails(read("/big"), /too big/);
    await fails(read("/pdf"), /PDF/);
    await fails(read("/missing"), /answered 404/);
  });
});
