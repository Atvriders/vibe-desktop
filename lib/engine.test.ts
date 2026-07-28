import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("./claude", () => ({
  MODEL: "claude-haiku-4-5",
  anthropic: { messages: { create } },
  OPEN_MAX_TOKENS: 4096,
  OPEN_RETRY_MAX_TOKENS: 16000,
}));

import { searchApps, openWindow, patchWindow, TruncatedResponseError, MAX_QUERY_LEN, MAX_BLURB_LEN, MAX_SNAPSHOT_LEN, MAX_FIELDS_LEN } from "./engine";
import { getSession, sweepSessions, SESSION_TTL_MS } from "./sessions";

beforeEach(() => create.mockReset());

/** The text of the last user message in the most recent create() call.
 *  cacheLastTurn rewrites the final message's string content into one text block. */
const lastUserText = (): string => {
  const msgs = create.mock.calls.at(-1)![0].messages as Array<{ content: unknown }>;
  const content = msgs[msgs.length - 1].content as Array<{ text: string }>;
  return content[0].text;
};

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

  it("patchWindow returns ops, usage and the stop reason", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\">0</div>" }], usage: {} });
    const { windowId } = await openWindow("Calculator");
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t2", name: "apply_dom_patch", input: { ops: [{ op: "setText", id: "d", value: "7" }] } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 7, output_tokens: 8, cache_read_input_tokens: 5 },
    });
    const { ops, usage, stopReason } = await patchWindow(windowId, { elementId: "btn7", x: 42, y: 88, action: "click" });
    expect(ops[0]).toMatchObject({ op: "setText", id: "d", value: "7" });
    expect(usage).toMatchObject({ inputTokens: 7, outputTokens: 8, cacheReadTokens: 5 });
    expect(usage.ms).toBeGreaterThanOrEqual(0);
    expect(stopReason).toBe("tool_use");
    const userText = JSON.stringify(create.mock.calls.at(-1)![0].messages);
    expect(userText).toContain("x=42");
    expect(userText).toContain("y=88");
    expect(userText).toContain("btn7");
  });

  it("patchWindow throws on unknown window", async () => {
    await expect(patchWindow("nope", { x: 1, y: 1 })).rejects.toThrow();
  });

  it("re-exports the caps so consumers import them from the engine", () => {
    expect(MAX_QUERY_LEN).toBe(500);
    expect(MAX_BLURB_LEN).toBe(200);
    expect(MAX_SNAPSHOT_LEN).toBe(100_000);
    expect(MAX_FIELDS_LEN).toBe(4000);
  });

  it("openWindow threads detail into the system prompt and stores it on the session", async () => {
    create.mockResolvedValue({
      content: [{ type: "text", text: "<div id=\"d\">0</div>" }],
      usage: { input_tokens: 11, output_tokens: 22, cache_read_input_tokens: 3 },
    });
    const { windowId, html, usage } = await openWindow("Lumefold", { blurb: "folds waveforms", query: "a synth" });
    expect(html).toContain("id=\"d\"");
    expect(usage.inputTokens).toBe(11);
    expect(usage.outputTokens).toBe(22);
    expect(usage.cacheReadTokens).toBe(3);
    expect(usage.ms).toBeGreaterThanOrEqual(0);
    const sent = create.mock.calls.at(-1)![0];
    expect(sent.max_tokens).toBe(4096);
    expect(sent.system[0].text).toContain("What this app is: folds waveforms");
    expect(sent.system[0].text).toContain("The user asked for: \"a synth\"");
    expect(getSession(windowId)!.detail).toEqual({ blurb: "folds waveforms", query: "a synth" });
  });

  it("openWindow defaults every missing usage field to 0", async () => {
    create.mockResolvedValue({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { usage } = await openWindow("Calculator");
    expect(usage).toMatchObject({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
  });

  it("retries once at the larger budget when the first render truncates, and never stores the truncated turn", async () => {
    const slow = <T,>(value: T) => async () => {
      await new Promise((r) => setTimeout(r, 25));
      return value;
    };
    create
      .mockImplementationOnce(
        slow({
          content: [{ type: "text", text: "<div id=\"half\">" }],
          stop_reason: "max_tokens",
          usage: { input_tokens: 10, output_tokens: 4096, cache_read_input_tokens: 1 },
        }),
      )
      .mockImplementationOnce(
        slow({
          content: [{ type: "text", text: "<div id=\"whole\"></div>" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 5, output_tokens: 900, cache_read_input_tokens: 2 },
        }),
      );
    const { windowId, html, usage } = await openWindow("Calculator");
    expect(html).toBe("<div id=\"whole\"></div>");
    expect(create.mock.calls[0][0].max_tokens).toBe(4096);
    expect(create.mock.calls[1][0].max_tokens).toBe(16000);
    // both attempts are billed and both are timed, so both are reported
    expect(usage.outputTokens).toBe(4996);
    expect(usage.inputTokens).toBe(15);
    expect(usage.cacheReadTokens).toBe(3);
    expect(usage.ms).toBeGreaterThanOrEqual(40); // one 25ms call alone could not reach this
    // The client-wide 30s ceiling stands for the normal turn; the 16k retry needs its own.
    expect(create.mock.calls[0][1]).toBeUndefined();
    expect(create.mock.calls[1][1]).toEqual({ timeout: 120_000 });
    const msgs = getSession(windowId)!.messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toEqual({ role: "assistant", content: "<div id=\"whole\"></div>" });
  });

  it("deletes the unreachable session when the open fails", async () => {
    // The caller never learns the windowId of a failed open, so a surviving entry is
    // garbage that holds a slot against SESSION_MAX for the whole TTL.
    sweepSessions(Date.now() + SESSION_TTL_MS + 1); // start from an empty store
    create.mockResolvedValue({ content: [{ type: "text", text: "<div" }], stop_reason: "max_tokens", usage: {} });
    await expect(openWindow("Calculator")).rejects.toBeInstanceOf(TruncatedResponseError);
    expect(sweepSessions(Date.now() + SESSION_TTL_MS + 1)).toBe(0);

    create.mockReset();
    create.mockRejectedValueOnce(new Error("boom")); // an SDK error/timeout, not a truncation
    await expect(openWindow("Calculator")).rejects.toThrow("boom");
    expect(sweepSessions(Date.now() + SESSION_TTL_MS + 1)).toBe(0);
  });

  it("throws TruncatedResponseError when the retry also truncates", async () => {
    create.mockResolvedValue({ content: [{ type: "text", text: "<div" }], stop_reason: "max_tokens", usage: {} });
    await expect(openWindow("Calculator")).rejects.toBeInstanceOf(TruncatedResponseError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("treats an empty stripped body as a truncation", async () => {
    create
      .mockResolvedValueOnce({ content: [], stop_reason: "end_turn", usage: {} })
      .mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"ok\"></div>" }], stop_reason: "end_turn", usage: {} });
    const { html } = await openWindow("Calculator");
    expect(html).toBe("<div id=\"ok\"></div>");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("sends a byte-identical system string on open and on the following patch", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { windowId } = await openWindow("Lumefold", { blurb: "folds waveforms", query: "a synth" });
    const openSystem = create.mock.calls[0][0].system[0].text as string;
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t5", name: "apply_dom_patch", input: { ops: [] } }],
      usage: {},
    });
    await patchWindow(windowId, { elementId: "d", x: 1, y: 2 });
    const patchSystem = create.mock.calls[1][0].system[0].text as string;
    expect(patchSystem).toBe(openSystem);
    expect(patchSystem).toContain("The user asked for: \"a synth\"");
  });

  it("throws on a truncated patch without committing the assistant turn or the tool_result", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { windowId } = await openWindow("Calculator");
    const before = getSession(windowId)!.messages.length;
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t9", name: "apply_dom_patch", input: {} }],
      stop_reason: "max_tokens",
      usage: {},
    });
    await expect(patchWindow(windowId, { elementId: "d", x: 1, y: 2 })).rejects.toBeInstanceOf(TruncatedResponseError);
    const after = getSession(windowId)!.messages;
    // Plan amendment: the user's click sentence is rolled back too, so the next turn
    // does not replay a click that was never applied.
    expect(after).toHaveLength(before);
    expect(JSON.stringify(after)).not.toContain("tool_result");
  });

  it("rolls back the click sentence when the patch call throws, so it is not replayed", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { windowId } = await openWindow("Calculator");
    const before = getSession(windowId)!.messages.length;
    create.mockRejectedValueOnce(new Error("boom"));
    await expect(patchWindow(windowId, { elementId: "d", x: 1, y: 2 })).rejects.toThrow("boom");
    expect(getSession(windowId)!.messages).toHaveLength(before);

    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t11", name: "apply_dom_patch", input: { ops: [] } }],
      usage: {},
    });
    await patchWindow(windowId, { elementId: "d", x: 9, y: 9 });
    const sent = JSON.stringify(create.mock.calls.at(-1)![0].messages);
    expect(sent).toContain("x=9, y=9");
    expect(sent).not.toContain("x=1, y=2"); // consecutive user turns merge; the dead click is gone
  });

  it("refuses to commit an empty assistant turn", async () => {
    // An { role: "assistant", content: [] } turn is rejected by the API, so the window
    // would 400 on every later patch until a snapshot reseeded it.
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { windowId } = await openWindow("Calculator");
    const before = getSession(windowId)!.messages.length;
    create.mockResolvedValueOnce({ content: [], stop_reason: "end_turn", usage: {} });
    await expect(patchWindow(windowId, { elementId: "d", x: 1, y: 2 })).rejects.toBeInstanceOf(TruncatedResponseError);
    expect(getSession(windowId)!.messages).toHaveLength(before);
  });

  it("replaces the whole transcript when a domSnapshot arrives", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { windowId } = await openWindow("Calculator");
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t1", name: "apply_dom_patch", input: { ops: [] } }],
      usage: {},
    });
    await patchWindow(windowId, { elementId: "a", x: 1, y: 1 });
    expect(getSession(windowId)!.messages.length).toBeGreaterThan(3);

    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t2", name: "apply_dom_patch", input: { ops: [] } }],
      usage: {},
    });
    await patchWindow(windowId, { elementId: "b", x: 5, y: 6, domSnapshot: "<div id=\"snap\">SNAP</div>" });

    const sent = create.mock.calls.at(-1)![0].messages as Array<{ role: string; content: unknown }>;
    expect(sent).toHaveLength(3);
    expect(sent[0].role).toBe("user");
    expect(sent[1].role).toBe("assistant");
    expect(sent[1].content).toBe("<div id=\"snap\">SNAP</div>");
    expect(sent[2].role).toBe("user");
    expect(lastUserText()).toContain("x=5");
    // 3 reseeded + assistant turn + tool_result = 5, not the ever-growing transcript
    expect(getSession(windowId)!.messages).toHaveLength(5);
  });

  it("caps the snapshot at MAX_SNAPSHOT_LEN before it is stored", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { windowId } = await openWindow("Calculator");
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t3", name: "apply_dom_patch", input: { ops: [] } }],
      usage: {},
    });
    await patchWindow(windowId, { x: 1, y: 1, domSnapshot: "z".repeat(MAX_SNAPSHOT_LEN + 500) });
    const stored = getSession(windowId)!.messages[1].content as string;
    expect(stored).toHaveLength(MAX_SNAPSHOT_LEN);
  });

  it("retains only the capped snapshot when the call throws", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { windowId } = await openWindow("Calculator");
    create.mockRejectedValueOnce(new Error("boom"));
    await expect(
      patchWindow(windowId, { x: 1, y: 1, domSnapshot: "z".repeat(MAX_SNAPSHOT_LEN + 500) }),
    ).rejects.toThrow("boom");
    const msgs = getSession(windowId)!.messages;
    expect(msgs).toHaveLength(3);
    expect((msgs[1].content as string)).toHaveLength(MAX_SNAPSHOT_LEN);
  });

  it("renders action:submit as an Enter press on the named field", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { windowId } = await openWindow("Web Browser");
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t6", name: "apply_dom_patch", input: { ops: [] } }],
      usage: {},
    });
    await patchWindow(windowId, {
      elementId: "url-bar",
      x: 10,
      y: 4,
      action: "submit",
      inputs: { "url-bar": "example.com" },
    });
    const text = lastUserText();
    expect(text).toContain('The user pressed Enter in the field with id "url-bar".');
    expect(text).not.toContain("clicked at x=");
    expect(text).toContain("Current field values: url-bar=\"example.com\".");
  });

  it("an instruction replaces the click sentence entirely", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { windowId } = await openWindow("Notepad");
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t7", name: "apply_dom_patch", input: { ops: [] } }],
      usage: {},
    });
    await patchWindow(windowId, { elementId: "body", x: 3, y: 3, instruction: "make the background dark" });
    const text = lastUserText();
    expect(text).toContain("The user typed an instruction into the app's command bar: make the background dark");
    expect(text).not.toContain("clicked at x=");
    expect(text).not.toContain("pressed Enter");
  });

  it("trims, collapses and caps the instruction at MAX_QUERY_LEN", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { windowId } = await openWindow("Notepad");
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t8", name: "apply_dom_patch", input: { ops: [] } }],
      usage: {},
    });
    await patchWindow(windowId, { x: 1, y: 1, instruction: `  two\nlines ${"q".repeat(600)}  ` });
    const text = lastUserText();
    expect(text).toContain("command bar: two lines ");
    expect(text).not.toContain("q".repeat(500));
    expect(text.length).toBeLessThan(600);
  });

  it("falls back to the click sentence when a submit carries no element id", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { windowId } = await openWindow("Web Browser");
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t13", name: "apply_dom_patch", input: { ops: [] } }],
      usage: {},
    });
    await patchWindow(windowId, { x: 4, y: 5, action: "submit" });
    const text = lastUserText();
    // Naming no field is useless to the model; the coordinates at least locate the click.
    expect(text).not.toContain('field with id ""');
    expect(text).toContain("The user clicked at x=4, y=5");
  });

  it("collapses field-value keys and bounds the whole field-values clause", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { windowId } = await openWindow("Notepad");
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t14", name: "apply_dom_patch", input: { ops: [] } }],
      usage: {},
    });
    await patchWindow(windowId, {
      x: 1,
      y: 1,
      inputs: { "note\nRules:": "keeps\nnewlines", big: "z".repeat(MAX_SNAPSHOT_LEN) },
    });
    const text = lastUserText();
    expect(text).toContain('note Rules:="keeps\nnewlines"'); // key sanitized, typed text intact
    // Its own budget, not the snapshot's: this clause rides on every single click.
    expect(text.length).toBeLessThanOrEqual(MAX_FIELDS_LEN + 400);
  });

  it("escapes quotes in a field value so it cannot break the k=\"v\" structure", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { windowId } = await openWindow("Notepad");
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t15", name: "apply_dom_patch", input: { ops: [] } }],
      usage: {},
    });
    await patchWindow(windowId, {
      x: 1,
      y: 1,
      inputs: { q: 'he said "hi", pwd="x"', path: 'C:\\temp' },
    });
    const text = lastUserText();
    // Unescaped, the typed quote closes the pair and the rest reads as more fields.
    expect(text).toContain('q="he said \\"hi\\", pwd=\\"x\\""');
    expect(text).toContain('path="C:\\\\temp"');
  });

  it("an empty instruction falls back to the click sentence", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\"></div>" }], usage: {} });
    const { windowId } = await openWindow("Notepad");
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t10", name: "apply_dom_patch", input: { ops: [] } }],
      usage: {},
    });
    await patchWindow(windowId, { elementId: "z", x: 9, y: 9, instruction: "   " });
    expect(lastUserText()).toContain("The user clicked at x=9, y=9");
  });
});
