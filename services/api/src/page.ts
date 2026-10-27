/**
 * Reading a public web page for a source check (#23). The API Lambda can reach the internet, and
 * the address comes from a newsletter, so it must never reach anything else: http or https on the
 * usual ports, every address the host resolves to public, checked at connect time (so a DNS answer
 * cannot change after the check), every redirect checked the same way, and limits on size and
 * time. Only HTML and plain text are read.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

export const PAGE_MAX_BYTES = 2_000_000;
export const PAGE_TIMEOUT_MS = 8_000;
export const PAGE_MAX_REDIRECTS = 3;

/** Why a page could not be read, in words the reader sees. */
export class PageError extends Error {}

/** A page as read: where it ended up after redirects, its type, and its body as text. */
export interface Page {
  url: string;
  contentType: string;
  body: string;
}

function isPublicV4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number) as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // shared address space (CGNAT)
  if (a === 169 && b === 254) return false; // link-local, the cloud metadata service
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return a < 224; // multicast and reserved above
}

/**
 * Whether an address is one on the public internet: not private, loopback, link-local, shared,
 * multicast, documentation or reserved, in IPv4 or IPv6, including IPv4 written inside IPv6.
 */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPublicV4(ip);
  if (kind !== 6) return false;
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPublicV4(mapped[1]!);
  // Global unicast is 2000::/3; within it, documentation, 6to4 and Teredo can hide other
  // addresses, and NAT64 (64:ff9b::/96) is outside it anyway.
  if (!/^[23]/.test(v6)) return false;
  return !/^(2001:0?db8:|2002:|2001:0?:|2001:0000:)/.test(v6);
}

/**
 * A DNS lookup that answers only public addresses. Given to the request as its `lookup`, it runs
 * as the connection is made, so the address connected to is the one checked.
 */
export function publicLookup(allowed: (ip: string) => boolean = isPublicAddress): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, found) => {
      const addresses = (found ?? []) as LookupAddress[];
      const blocked =
        err ??
        (addresses.length && addresses.every((a) => allowed(a.address))
          ? undefined
          : new PageError("the address is not a public one"));
      if (blocked) return (callback as (e: Error) => void)(blocked);
      if (options.all) return (callback as (e: null, a: LookupAddress[]) => void)(null, addresses);
      const first = addresses[0]!;
      (callback as (e: null, a: string, f: number) => void)(null, first.address, first.family);
    });
  };
}

interface Raw {
  status: number;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

/** One request, no redirects followed, within the size and time limits. */
function get(url: URL, allowed: (ip: string) => boolean, deadline: number): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const left = deadline - Date.now();
    if (left <= 0) return reject(new PageError("the page took too long"));
    const req = request(
      url,
      {
        method: "GET",
        lookup: publicLookup(allowed),
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; Nutgraf source check)",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          encoding === "gzip"
            ? res.pipe(createGunzip())
            : encoding === "br"
              ? res.pipe(createBrotliDecompress())
              : encoding === "deflate"
                ? res.pipe(createInflate())
                : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > PAGE_MAX_BYTES) {
            req.destroy();
            reject(new PageError("the page is too big"));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        stream.on("error", () => reject(new PageError("the page could not be read")));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      reject(new PageError("the page took too long"));
    }, left);
    req.on("close", () => clearTimeout(timer));
    req.on("error", (err) =>
      reject(err instanceof PageError ? err : new PageError("the page could not be reached")),
    );
    req.end();
  });
}

/**
 * Read a public page: redirects followed up to a limit, each checked as the first was. Throws a
 * PageError, whose message says why, for anything else.
 */
export async function fetchPage(
  link: string,
  /** For tests: which addresses and ports may be reached (public ones, and 80 and 443). */
  opts: { allowed?: (ip: string) => boolean; ports?: string[] } = {},
): Promise<Page> {
  const allowed = opts.allowed ?? isPublicAddress;
  const ports = opts.ports ?? ["", "80", "443"];
  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new PageError("the link is not a web address");
  }
  for (let hop = 0; hop <= PAGE_MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new PageError("the link is not a web page");
    }
    if (!ports.includes(url.port)) {
      throw new PageError("the link is not on a web port");
    }
    if (url.username || url.password) throw new PageError("the link carries a password");
    // An address written as a number is never looked up, so check it here.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !allowed(host)) throw new PageError("the address is not a public one");

    const res = await get(url, allowed, deadline);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    if (res.status !== 200) throw new PageError(`the page answered ${res.status}`);
    const type = String(res.headers["content-type"] ?? "").toLowerCase();
    if (!/^(text\/html|application\/xhtml\+xml|text\/plain)\b/.test(type)) {
      throw new PageError("the page is not a web page or text (a PDF or a file)");
    }
    return { url: url.href, contentType: type, body: res.body.toString("utf8") };
  }
  throw new PageError("the page redirects too many times");
}
