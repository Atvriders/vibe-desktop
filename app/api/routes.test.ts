import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { APIConnectionError, RateLimitError } from "@anthropic-ai/sdk";

const searchApps = vi.hoisted(() => vi.fn());
const openWindow = vi.hoisted(() => vi.fn());
const patchWindow = vi.hoisted(() => vi.fn());
const UnknownWindowError = vi.hoisted(() => class UnknownWindowError extends Error {});
const TruncatedResponseError = vi.hoisted(() => class TruncatedResponseError extends Error {});
vi.mock("@/lib/engine", () => ({ searchApps, openWindow, patchWindow, UnknownWindowError, TruncatedResponseError }));

import { POST as searchPOST } from "./search/route";
import { POST as openPOST } from "./window/open/route";
import { POST as patchPOST } from "./window/patch/route";
import { POST as closePOST } from "./window/close/route";
import { newSession, getSession } from "@/lib/sessions";

// Every request gets its own RFC 5737 documentation address so the real per-IP
// token bucket in lib/http-guard.ts can never leak budget between tests.
let ipCounter = 0;
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://test/api", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${++ipCounter}`, ...headers },
    body: JSON.stringify(body),
  });

const rateLimited = () => new RateLimitError(429, { type: "error" }, "rate limited", new Headers());
const connFailed = () => new APIConnectionError({ message: "socket hang up" });

beforeEach(() => {
  searchApps.mockReset();
  openWindow.mockReset();
  patchWindow.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("api routes", () => {
  it("search returns cards", async () => {
    searchApps.mockResolvedValue([{ id: "1", name: "X", icon: "⭐", blurb: "b" }]);
    const res = await searchPOST(post({ query: "x" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cards: [{ id: "1", name: "X", icon: "⭐", blurb: "b" }] });
  });

  it("search 400s on missing query", async () => {
    const res = await searchPOST(post({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "query required" });
    expect(searchApps).not.toHaveBeenCalled();
  });

  it("search 400s on a non-string query", async () => {
    const res = await searchPOST(post({ query: 42 }));
    expect(res.status).toBe(400);
    // The route has two 400 producers (guard vs field check); pin which one fired.
    expect(await res.json()).toEqual({ error: "query required" });
    expect(searchApps).not.toHaveBeenCalled();
  });

  it("search rejects a text/plain body before touching the engine", async () => {
    const res = await searchPOST(post({ query: "x" }, { "content-type": "text/plain" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expected application/json" });
    expect(searchApps).not.toHaveBeenCalled();
  });

  it("search 503s on an Anthropic rate limit", async () => {
    searchApps.mockRejectedValue(rateLimited());
    const res = await searchPOST(post({ query: "x" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "overloaded" });
  });

  it("search 504s on a connection failure", async () => {
    searchApps.mockRejectedValue(connFailed());
    const res = await searchPOST(post({ query: "x" }));
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "timeout" });
  });

  it("search 502s on anything else", async () => {
    searchApps.mockRejectedValue(new Error("boom"));
    const res = await searchPOST(post({ query: "x" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "search failed" });
  });

  const okOpen = { windowId: "w1", html: "<div id=\"d\"></div>", usage: { ms: 120, inputTokens: 800, outputTokens: 900, cacheReadTokens: 0 } };

  it("open returns windowId, html and usage", async () => {
    openWindow.mockResolvedValue(okOpen);
    const res = await openPOST(post({ appName: "Calc" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(okOpen);
  });

  it("open with appName alone passes NO detail through, so the prompt stays byte-identical", async () => {
    openWindow.mockResolvedValue(okOpen);
    await openPOST(post({ appName: "Calc" }));
    expect(openWindow).toHaveBeenCalledWith("Calc", undefined);
  });

  it("open forwards blurb and query as an AppDetail", async () => {
    openWindow.mockResolvedValue(okOpen);
    await openPOST(post({ appName: "Lumefold", blurb: "folds waveforms into light", query: "a synth with 3 oscillators" }));
    expect(openWindow).toHaveBeenCalledWith("Lumefold", { blurb: "folds waveforms into light", query: "a synth with 3 oscillators" });
  });

  it("open forwards a blurb with no query (the builtin-app case)", async () => {
    openWindow.mockResolvedValue(okOpen);
    await openPOST(post({ appName: "Web Browser", blurb: "browse the web" }));
    expect(openWindow).toHaveBeenCalledWith("Web Browser", { blurb: "browse the web", query: undefined });
  });

  it("open forwards a query with no blurb", async () => {
    openWindow.mockResolvedValue(okOpen);
    await openPOST(post({ appName: "Lumefold", query: "make me a synth" }));
    expect(openWindow).toHaveBeenCalledWith("Lumefold", { blurb: undefined, query: "make me a synth" });
  });

  it("open 400s on a non-string blurb", async () => {
    const res = await openPOST(post({ appName: "Calc", blurb: 7 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "blurb required" });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("open 400s on a non-string query", async () => {
    const res = await openPOST(post({ appName: "Calc", query: { evil: true } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "query required" });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("open 400s on a missing appName", async () => {
    const res = await openPOST(post({ blurb: "b" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "appName required" });
    expect(openWindow).not.toHaveBeenCalled();
  });

  // Boundary pin: length caps (MAX_BLURB_LEN / MAX_QUERY_LEN) live in lib/engine.ts.
  // The route must NOT truncate, or the cap would be applied twice.
  it("open passes over-long values through verbatim — capping is the engine's job", async () => {
    openWindow.mockResolvedValue(okOpen);
    const longQuery = "q".repeat(900);
    const longBlurb = "b".repeat(400);
    await openPOST(post({ appName: "Calc", blurb: longBlurb, query: longQuery }));
    expect(openWindow).toHaveBeenCalledWith("Calc", { blurb: longBlurb, query: longQuery });
  });

  it("open rejects a text/plain body before touching the engine", async () => {
    const res = await openPOST(post({ appName: "Calc" }, { "content-type": "text/plain" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expected application/json" });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("open 503s on an Anthropic rate limit", async () => {
    openWindow.mockRejectedValue(rateLimited());
    const res = await openPOST(post({ appName: "Calc" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "overloaded" });
  });

  it("open 504s on a connection failure", async () => {
    openWindow.mockRejectedValue(connFailed());
    const res = await openPOST(post({ appName: "Calc" }));
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "timeout" });
  });

  it("open 502s on a truncated response", async () => {
    openWindow.mockRejectedValue(new TruncatedResponseError("hit max_tokens"));
    const res = await openPOST(post({ appName: "Calc" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "open failed" });
  });

  const okPatch = {
    ops: [{ op: "setText", id: "d", value: "7" }],
    stopReason: "tool_use",
    usage: { ms: 900, inputTokens: 1200, outputTokens: 60, cacheReadTokens: 4100 },
  };

  // The mock resolves an EXTRA `cacheReadTokens` — exactly what today's engine returns —
  // because today's route does `NextResponse.json(result)` and echoes the engine's whole
  // object. The frozen contract is a three-field projection, so echoing must stop.
  // (Without the extra field this test would pass against the unmodified route: Vitest's
  // toHaveBeenCalledWith ignores explicit-undefined properties, so the missing `instruction`
  // key alone does not fail the arg assertion. Verified.)
  it("patch returns exactly ops, stopReason and usage — engine extras are not echoed", async () => {
    patchWindow.mockResolvedValue({ ...okPatch, cacheReadTokens: 5 });
    const res = await patchPOST(post({ windowId: "w1", elementId: "b7", x: 10, y: 20, action: "click" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(okPatch);
    expect(patchWindow).toHaveBeenCalledWith("w1", {
      elementId: "b7", x: 10, y: 20, action: "click",
      inputs: {}, domSnapshot: undefined, instruction: undefined,
    });
  });

  it("patch forwards the submit action", async () => {
    patchWindow.mockResolvedValue(okPatch);
    await patchPOST(post({ windowId: "w1", elementId: "url", x: 5, y: 5, action: "submit" }));
    expect(patchWindow.mock.calls[0][1].action).toBe("submit");
  });

  it("patch forwards contextmenu, and falls back to click for an unknown action", async () => {
    patchWindow.mockResolvedValue(okPatch);
    await patchPOST(post({ windowId: "w1", elementId: "a", x: 1, y: 1, action: "contextmenu" }));
    expect(patchWindow.mock.calls[0][1].action).toBe("contextmenu");
    await patchPOST(post({ windowId: "w1", elementId: "a", x: 1, y: 1, action: "dblclick" }));
    expect(patchWindow.mock.calls[1][1].action).toBe("click");
  });

  it("patch forwards a free-text instruction", async () => {
    patchWindow.mockResolvedValue(okPatch);
    await patchPOST(post({ windowId: "w1", elementId: null, x: 0, y: 0, instruction: "undo that" }));
    expect(patchWindow.mock.calls[0][1].instruction).toBe("undo that");
  });

  it("patch forwards inputs and domSnapshot", async () => {
    patchWindow.mockResolvedValue(okPatch);
    await patchPOST(post({ windowId: "w1", elementId: "u", x: 0, y: 0, inputs: { u: "hi" }, domSnapshot: "<div id=\"app-root\"></div>" }));
    expect(patchWindow.mock.calls[0][1].inputs).toEqual({ u: "hi" });
    expect(patchWindow.mock.calls[0][1].domSnapshot).toBe("<div id=\"app-root\"></div>");
  });

  // inputs arrives from req.json() as `any`, so the container check alone would let
  // non-string values reach patchWindow while still typed as Record<string, string>.
  it("patch drops non-string values from inputs", async () => {
    patchWindow.mockResolvedValue(okPatch);
    await patchPOST(post({ windowId: "w1", elementId: "u", x: 0, y: 0, inputs: { u: "hi", n: 3, o: { a: 1 }, z: null } }));
    expect(patchWindow.mock.calls[0][1].inputs).toEqual({ u: "hi" });
  });

  it("patch replaces a non-object inputs with an empty record", async () => {
    patchWindow.mockResolvedValue(okPatch);
    await patchPOST(post({ windowId: "w1", elementId: "u", x: 0, y: 0, inputs: "haha" }));
    expect(patchWindow.mock.calls[0][1].inputs).toEqual({});
  });

  it("patch 400s on a missing windowId, x or y", async () => {
    expect((await patchPOST(post({ elementId: "b", x: 1, y: 1 }))).status).toBe(400);
    expect((await patchPOST(post({ windowId: "w1", elementId: "b", y: 1 }))).status).toBe(400);
    expect((await patchPOST(post({ windowId: "w1", elementId: "b", x: 1 }))).status).toBe(400);
    expect(patchWindow).not.toHaveBeenCalled();
  });

  // Today `!windowId` lets any truthy non-string through and it reaches getSession as-is.
  it("patch 400s on a non-string windowId", async () => {
    patchWindow.mockResolvedValue(okPatch);
    const res = await patchPOST(post({ windowId: 5, elementId: "b", x: 0, y: 0 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "windowId, x and y required" });
    expect(patchWindow).not.toHaveBeenCalled();
  });

  it("patch 400s on a non-string instruction", async () => {
    const res = await patchPOST(post({ windowId: "w1", elementId: null, x: 0, y: 0, instruction: 9 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "instruction required" });
    expect(patchWindow).not.toHaveBeenCalled();
  });

  it("patch 400s on a non-string domSnapshot", async () => {
    const res = await patchPOST(post({ windowId: "w1", elementId: null, x: 0, y: 0, domSnapshot: 9 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "domSnapshot required" });
    expect(patchWindow).not.toHaveBeenCalled();
  });

  it("patch rejects a text/plain body before touching the engine", async () => {
    const res = await patchPOST(post({ windowId: "w1", elementId: "b", x: 0, y: 0 }, { "content-type": "text/plain" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expected application/json" });
    expect(patchWindow).not.toHaveBeenCalled();
  });

  it("patch 404s on unknown window — checked before every other error", async () => {
    patchWindow.mockRejectedValue(new UnknownWindowError("unknown window: ghost"));
    const res = await patchPOST(post({ windowId: "ghost", elementId: "b", x: 0, y: 0 }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown window" });
  });

  it("patch 503s on an Anthropic rate limit", async () => {
    patchWindow.mockRejectedValue(rateLimited());
    const res = await patchPOST(post({ windowId: "w1", elementId: "b", x: 0, y: 0 }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "overloaded" });
  });

  it("patch 504s on a connection failure", async () => {
    patchWindow.mockRejectedValue(connFailed());
    const res = await patchPOST(post({ windowId: "w1", elementId: "b", x: 0, y: 0 }));
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "timeout" });
  });

  it("patch 502s on a truncated response", async () => {
    patchWindow.mockRejectedValue(new TruncatedResponseError("hit max_tokens"));
    const res = await patchPOST(post({ windowId: "w1", elementId: "b", x: 0, y: 0 }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "patch failed" });
  });

  it("close deletes the session and returns 200 { ok: true }", async () => {
    const s = newSession("Calculator");
    expect(getSession(s.id)).toBeDefined();
    const res = await closePOST(post({ windowId: s.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(getSession(s.id)).toBeUndefined();
  });

  it("close 400s on a missing windowId", async () => {
    const res = await closePOST(post({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "windowId required" });
  });

  it("close 400s on a non-string windowId", async () => {
    const res = await closePOST(post({ windowId: 5 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "windowId required" });
  });

  it("close rejects a text/plain body", async () => {
    const res = await closePOST(post({ windowId: "x" }, { "content-type": "text/plain" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expected application/json" });
  });
});
