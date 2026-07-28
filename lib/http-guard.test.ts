import { describe, it, expect, vi, afterEach } from "vitest";
import { guardRequest, errorResponse, MAX_BODY_BYTES } from "./http-guard";
import { APIConnectionError, APIConnectionTimeoutError, APIError, RateLimitError } from "@anthropic-ai/sdk";

// RFC 5737 documentation addresses. Every test uses its own address so the
// per-IP token bucket added in Task 2 can never starve a later test.
function req(headers: Record<string, string>): Request {
  return new Request("http://test/api/window/open", { method: "POST", headers, body: "{}" });
}
function jsonReq(ip: string): Request {
  return req({ "content-type": "application/json", "x-forwarded-for": ip });
}

// A Date.now spy that survives a mid-test failure would freeze the clock for every
// later test in this file, so restore centrally rather than on the last line of each.
afterEach(() => vi.restoreAllMocks());

describe("guardRequest — content type", () => {
  it("allows a plain application/json POST", () => {
    expect(guardRequest(jsonReq("192.0.2.1"))).toBeNull();
  });

  it("allows application/json with a charset parameter", () => {
    const res = guardRequest(req({ "content-type": "application/json; charset=utf-8", "x-forwarded-for": "192.0.2.2" }));
    expect(res).toBeNull();
  });

  it("rejects the CORS-simple text/plain body with 400", async () => {
    const res = guardRequest(req({ "content-type": "text/plain", "x-forwarded-for": "192.0.2.3" }));
    expect(res?.status).toBe(400);
    expect(await res!.json()).toEqual({ error: "expected application/json" });
  });

  it("rejects a request with no content-type header at all with 400", () => {
    const bare = new Request("http://test/api", { method: "POST", headers: { "x-forwarded-for": "192.0.2.4" } });
    expect(bare.headers.get("content-type")).toBeNull();
    expect(guardRequest(bare)?.status).toBe(400);
  });

  it("rejects a string body sent with no explicit content-type (fetch defaults it to text/plain)", () => {
    const b = new Request("http://test/api", { method: "POST", headers: { "x-forwarded-for": "192.0.2.5" }, body: "{}" });
    expect(b.headers.get("content-type")).toBe("text/plain;charset=UTF-8");
    expect(guardRequest(b)?.status).toBe(400);
  });
});

describe("guardRequest — cross-site origin", () => {
  it("rejects Sec-Fetch-Site: cross-site with 403", async () => {
    const res = guardRequest(req({ "content-type": "application/json", "sec-fetch-site": "cross-site", "x-forwarded-for": "192.0.2.6" }));
    expect(res?.status).toBe(403);
    expect(await res!.json()).toEqual({ error: "cross-site request rejected" });
  });

  it("allows same-origin, same-site and none", () => {
    ["same-origin", "same-site", "none"].forEach((site, i) => {
      const res = guardRequest(req({ "content-type": "application/json", "sec-fetch-site": site, "x-forwarded-for": `192.0.2.1${i}` }));
      expect(res).toBeNull();
    });
  });
});

describe("guardRequest — body size", () => {
  it("MAX_BODY_BYTES is 256KB", () => {
    expect(MAX_BODY_BYTES).toBe(256 * 1024);
  });

  it("rejects a content-length over MAX_BODY_BYTES with 413", async () => {
    const res = guardRequest(req({
      "content-type": "application/json",
      "content-length": String(MAX_BODY_BYTES + 1),
      "x-forwarded-for": "192.0.2.20",
    }));
    expect(res?.status).toBe(413);
    expect(await res!.json()).toEqual({ error: "body too large" });
  });

  it("allows a content-length exactly at MAX_BODY_BYTES", () => {
    const res = guardRequest(req({
      "content-type": "application/json",
      "content-length": String(MAX_BODY_BYTES),
      "x-forwarded-for": "192.0.2.21",
    }));
    expect(res).toBeNull();
  });

  it("allows a request with no content-length header", () => {
    expect(guardRequest(jsonReq("192.0.2.22"))).toBeNull();
  });
});

// The bucket holds 60 tokens and refills 60/minute; these tests hard-code 60.
describe("guardRequest — per-IP rate limit", () => {
  it("allows a full burst then 429s with a Retry-After header", async () => {
    const ip = "198.51.100.1";
    for (let i = 0; i < 60; i++) expect(guardRequest(jsonReq(ip))).toBeNull();
    const res = guardRequest(jsonReq(ip));
    expect(res?.status).toBe(429);
    expect(await res!.json()).toEqual({ error: "too many requests" });
    expect(Number(res!.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  it("buckets are per-IP: a second address is unaffected by an exhausted one", () => {
    const hot = "198.51.100.2";
    for (let i = 0; i < 61; i++) guardRequest(jsonReq(hot));
    expect(guardRequest(jsonReq(hot))?.status).toBe(429);
    expect(guardRequest(jsonReq("198.51.100.3"))).toBeNull();
  });

  // Only the LAST hop is appended by the proxy in front of us; everything before it
  // is text the caller typed, so keying on the first hop would let one curl loop mint
  // an unlimited number of full buckets.
  it("keys on the LAST hop of x-forwarded-for, so a forged prefix cannot mint fresh buckets", () => {
    const hdr = (forged: string) => req({ "content-type": "application/json", "x-forwarded-for": `${forged}, 198.51.100.4` });
    for (let i = 0; i < 60; i++) guardRequest(hdr(`203.0.113.${1000 + i}`));
    expect(guardRequest(hdr("203.0.113.2000"))?.status).toBe(429);
  });

  it("honours TRUSTED_PROXY_HOPS=2 by keying on the second-from-last hop", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    try {
      const hdr = (i: number) =>
        req({ "content-type": "application/json", "x-forwarded-for": `203.0.113.${3000 + i}, 198.51.100.7, 192.0.2.${100 + i}` });
      for (let i = 0; i < 60; i++) guardRequest(hdr(i));
      expect(guardRequest(hdr(200))?.status).toBe(429);
    } finally {
      delete process.env.TRUSTED_PROXY_HOPS;
    }
  });

  it("refills over time", () => {
    const t0 = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(t0);
    const ip = "198.51.100.5";
    for (let i = 0; i < 60; i++) guardRequest(jsonReq(ip));
    expect(guardRequest(jsonReq(ip))?.status).toBe(429);
    now.mockReturnValue(t0 + 60_000);
    expect(guardRequest(jsonReq(ip))).toBeNull();
  });

  // An NTP correction, VM snapshot restore or container resume can move Date.now
  // backwards; an unclamped refill would drive the bucket deeply negative and 429
  // the app's only user for the size of the step.
  it("a backward clock step does not lock a client out", () => {
    const t0 = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(t0);
    const ip = "198.51.100.8";
    expect(guardRequest(jsonReq(ip))).toBeNull();
    now.mockReturnValue(t0 - 3_600_000);
    expect(guardRequest(jsonReq(ip))).toBeNull();
    now.mockReturnValue(t0);
    expect(guardRequest(jsonReq(ip))).toBeNull();
  });

  it("holds a hard ceiling on the map even when no bucket is prunable", () => {
    const t0 = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(t0);
    for (let i = 0; i < 1000; i++) guardRequest(jsonReq(`203.0.113.${i}`));
    const map = (globalThis as unknown as { __vibeRateBuckets: Map<string, unknown> }).__vibeRateBuckets;
    // Frozen clock: nothing has refilled, so prune frees nothing and only the
    // least-recently-seen eviction keeps the cap honest.
    expect(map.size).toBeLessThanOrEqual(1000);
    now.mockReturnValue(t0 + 60_000);
    guardRequest(jsonReq("198.51.100.200"));
    expect(map.size).toBeLessThan(1000);
  });

  it("survives a module reload (Next dev HMR) because the map hangs off globalThis", async () => {
    const ip = "198.51.100.6";
    for (let i = 0; i < 60; i++) guardRequest(jsonReq(ip));
    vi.resetModules();
    const reloaded = await import("./http-guard");
    expect(reloaded.guardRequest(jsonReq(ip))?.status).toBe(429);
  });
});

describe("errorResponse", () => {
  it("maps RateLimitError to 503 overloaded", async () => {
    const res = errorResponse(new RateLimitError(429, { type: "error" }, "rate limited", new Headers()), "patch");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "overloaded" });
  });

  it("maps a 529 overload to 503 overloaded (it is NOT a RateLimitError)", async () => {
    const e = APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, "Overloaded", new Headers());
    expect(e instanceof RateLimitError).toBe(false);
    const res = errorResponse(e, "patch");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "overloaded" });
  });

  it("maps APIConnectionError to 504 timeout", async () => {
    const res = errorResponse(new APIConnectionError({ message: "socket hang up" }), "open");
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "timeout" });
  });

  it("maps APIConnectionTimeoutError to 504 timeout", async () => {
    const res = errorResponse(new APIConnectionTimeoutError({ message: "timed out" }), "open");
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "timeout" });
  });

  it("maps a plain 500 APIError to 502 with the verb", async () => {
    const e = APIError.generate(500, { type: "error", error: { type: "api_error", message: "oops" } }, "oops", new Headers());
    const res = errorResponse(e, "patch");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "patch failed" });
  });

  it("maps an unrecognised error to 502 with the verb", async () => {
    const res = errorResponse(new Error("boom"), "search");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "search failed" });
  });
});
