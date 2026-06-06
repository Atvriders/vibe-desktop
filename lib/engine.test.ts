import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("./claude", () => ({ MODEL: "claude-haiku-4-5", anthropic: { messages: { create } } }));

import { searchApps, openWindow, patchWindow } from "./engine";

beforeEach(() => create.mockReset());

describe("engine", () => {
  it("searchApps returns the tool's cards array", async () => {
    create.mockResolvedValue({
      content: [{ type: "tool_use", id: "t1", name: "app_results", input: { cards: [{ id: "1", name: "Synthy", icon: "🎹", blurb: "make noise" }] } }],
      usage: {},
    });
    const cards = await searchApps("a synth");
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("Synthy");
  });

  it("openWindow returns html and stores a session", async () => {
    create.mockResolvedValue({ content: [{ type: "text", text: "<div id=\"d\">0</div>" }], usage: {} });
    const { windowId, html } = await openWindow("Calculator");
    expect(windowId).toBeTruthy();
    expect(html).toContain("id=\"d\"");
  });

  it("patchWindow returns ops and sends coordinate-aware wording", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\">0</div>" }], usage: {} });
    const { windowId } = await openWindow("Calculator");
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t2", name: "apply_dom_patch", input: { ops: [{ op: "setText", id: "d", value: "7" }] } }],
      usage: { cache_read_input_tokens: 5 },
    });
    const { ops, cacheReadTokens } = await patchWindow(windowId, { elementId: "btn7", x: 42, y: 88, action: "click" });
    expect(ops[0]).toMatchObject({ op: "setText", id: "d", value: "7" });
    expect(cacheReadTokens).toBe(5);
    const lastCall = create.mock.calls.at(-1)![0];
    const userText = JSON.stringify(lastCall.messages);
    expect(userText).toContain("x=42");
    expect(userText).toContain("y=88");
    expect(userText).toContain("btn7");
  });

  it("patchWindow throws on unknown window", async () => {
    await expect(patchWindow("nope", { x: 1, y: 1 })).rejects.toThrow();
  });
});
