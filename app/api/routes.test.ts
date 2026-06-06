import { describe, it, expect, vi, beforeEach } from "vitest";

const searchApps = vi.hoisted(() => vi.fn());
const openWindow = vi.hoisted(() => vi.fn());
const patchWindow = vi.hoisted(() => vi.fn());
const UnknownWindowError = vi.hoisted(() => class UnknownWindowError extends Error {});
vi.mock("@/lib/engine", () => ({ searchApps, openWindow, patchWindow, UnknownWindowError }));

import { POST as searchPOST } from "./search/route";
import { POST as openPOST } from "./window/open/route";
import { POST as patchPOST } from "./window/patch/route";
import { POST as closePOST } from "./window/close/route";

const post = (body: unknown) =>
  new Request("http://test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => { searchApps.mockReset(); openWindow.mockReset(); patchWindow.mockReset(); });

describe("api routes", () => {
  it("search returns cards", async () => {
    searchApps.mockResolvedValue([{ id: "1", name: "X", icon: "⭐", blurb: "b" }]);
    const res = await searchPOST(post({ query: "x" }));
    expect(await res.json()).toEqual({ cards: [{ id: "1", name: "X", icon: "⭐", blurb: "b" }] });
  });

  it("search 400s on missing query", async () => {
    const res = await searchPOST(post({}));
    expect(res.status).toBe(400);
  });

  it("open returns windowId + html", async () => {
    openWindow.mockResolvedValue({ windowId: "w1", html: "<div id=\"d\"></div>" });
    const res = await openPOST(post({ appName: "Calc" }));
    expect(await res.json()).toEqual({ windowId: "w1", html: "<div id=\"d\"></div>" });
  });

  it("patch returns ops", async () => {
    patchWindow.mockResolvedValue({ ops: [{ op: "setText", id: "d", value: "7" }], cacheReadTokens: 5 });
    const res = await patchPOST(post({ windowId: "w1", elementId: "b7", x: 10, y: 20, action: "click" }));
    expect(await res.json()).toEqual({ ops: [{ op: "setText", id: "d", value: "7" }], cacheReadTokens: 5 });
    expect(patchWindow).toHaveBeenCalledWith("w1", { elementId: "b7", x: 10, y: 20, action: "click", inputs: {}, domSnapshot: undefined });
  });

  it("patch 404s on unknown window", async () => {
    patchWindow.mockRejectedValue(new UnknownWindowError("unknown window"));
    const res = await patchPOST(post({ windowId: "ghost", elementId: "b", x: 0, y: 0 }));
    expect(res.status).toBe(404);
  });

  it("close returns 204", async () => {
    const res = await closePOST(post({ windowId: "x" }));
    expect(res.status).toBe(204);
  });
});
