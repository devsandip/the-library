import { describe, expect, it } from "vitest";
import { base64url, pkceChallenge, randomString } from "../src/auth.js";
import { relativeTime } from "../src/format.js";

describe("PKCE helpers", () => {
  it("matches the RFC 7636 appendix B example", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("base64url has no padding or unsafe characters", () => {
    expect(base64url(new Uint8Array([251, 255, 254]))).toBe("-__-");
    expect(randomString(48)).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  it.each([
    ["2026-10-09T11:59:50Z", "just now"],
    ["2026-10-09T11:15:00Z", "45m ago"],
    ["2026-10-09T07:00:00Z", "5h ago"],
    ["2026-10-08T06:00:00Z", "yesterday"],
  ])("%s -> %s", (iso, want) => {
    expect(relativeTime(iso, now)).toBe(want);
  });
});
