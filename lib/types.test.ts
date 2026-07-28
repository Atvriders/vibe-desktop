import { describe, it, expect } from "vitest";
import { MAX_QUERY_LEN, MAX_BLURB_LEN, MAX_SNAPSHOT_LEN, MAX_FIELDS_LEN, MAX_INPUTS_LEN, promptLine } from "./types";
import type { AppDetail, CallUsage, WindowSession } from "./types";

describe("shared types", () => {
  it("exposes the frozen caps on user-authored text", () => {
    expect(MAX_QUERY_LEN).toBe(500);
    expect(MAX_BLURB_LEN).toBe(200);
    // Deliberately lowered from 200_000: the snapshot is JSON-escaped into a body
    // that http-guard rejects over 256KB, and escaping roughly doubles HTML.
    expect(MAX_SNAPSHOT_LEN).toBe(100_000);
    expect(MAX_FIELDS_LEN).toBe(4000);
    // Sized off MAX_FIELDS_LEN: 3 bytes is the most one non-astral character can
    // cost, so this is everything the server's clause cap could possibly keep.
    expect(MAX_INPUTS_LEN).toBe(12_000);
  });

  it("WindowSession carries an optional detail and a lastUsed stamp", () => {
    const detail: AppDetail = { blurb: "folds waveforms into light", query: "a synth" };
    const session: WindowSession = { id: "w1", appName: "Lumefold", detail, messages: [], lastUsed: 1234 };
    expect(session.detail?.query).toBe("a synth");
    expect(session.lastUsed).toBe(1234);
  });

  it("CallUsage carries latency and the three token counters", () => {
    const usage: CallUsage = { ms: 1700, inputTokens: 900, outputTokens: 400, cacheReadTokens: 4100 };
    expect(Object.keys(usage).sort()).toEqual(["cacheReadTokens", "inputTokens", "ms", "outputTokens"]);
  });
});

describe("promptLine", () => {
  it("trims, collapses newlines to spaces, and caps", () => {
    expect(promptLine("  two\nlines  ", 100)).toBe("two lines");
    expect(promptLine("a\r\n\r\nb", 100)).toBe("a b");
    expect(promptLine("x".repeat(600), 500)).toBe("x".repeat(500));
    expect(promptLine(`${"y".repeat(499)}   z`, 500)).toBe("y".repeat(499));
  });

  it("returns an empty string for anything that is not a string", () => {
    expect(promptLine(undefined, 100)).toBe("");
    expect(promptLine(42 as unknown as string, 100)).toBe("");
  });
});
