import { describe, it, expect } from "vitest";
import { byteLength, capFieldMap, truncateBytes } from "./byte-cap";
import { MAX_INPUTS_LEN } from "./types";

/** Every code point of the result, so a surviving surrogate PAIR reads as one
 *  astral character and only an unpaired half lands in the D800–DFFF range. */
const hasLoneSurrogate = (s: string) =>
  [...s].some((c) => c.codePointAt(0)! >= 0xd800 && c.codePointAt(0)! <= 0xdfff);

describe("byteLength", () => {
  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("é")).toBe(2);
    expect(byteLength("漢")).toBe(3);
    // One emoji: two code units in the string, four bytes on the wire.
    expect("😀".length).toBe(2);
    expect(byteLength("😀")).toBe(4);
  });
});

describe("truncateBytes", () => {
  it("returns the value untouched when it already fits", () => {
    expect(truncateBytes("hello", 5)).toBe("hello");
    expect(truncateBytes("漢字", 100)).toBe("漢字");
    expect(truncateBytes("", 10)).toBe("");
  });

  it("cuts multi-byte text by byte length, where slice() would not have cut at all", () => {
    const cjk = "漢".repeat(1000);
    // The bug in one line: 1000 characters, 3000 bytes.
    expect(cjk.slice(0, 1200)).toHaveLength(1000);
    const out = truncateBytes(cjk, 1200);
    expect(byteLength(out)).toBeLessThanOrEqual(1200);
    expect(out).toHaveLength(400);
  });

  it("never splits a surrogate pair, so the result is always valid UTF-8", () => {
    // 4 bytes per emoji against odd budgets: every cut lands between characters.
    for (const budget of [1, 2, 3, 4, 5, 6, 7, 8, 9, 11]) {
      const out = truncateBytes("😀".repeat(10), budget);
      expect(hasLoneSurrogate(out), `budget ${budget}`).toBe(false);
      expect(byteLength(out), `budget ${budget}`).toBeLessThanOrEqual(budget);
      expect(out).toBe("😀".repeat(Math.floor(budget / 4)));
    }
  });

  it("survives the JSON round trip it exists to protect", () => {
    const out = truncateBytes(`mixed ${"漢"} ${"😀".repeat(50)}`, 37);
    expect(JSON.parse(JSON.stringify(out))).toBe(out);
    expect(byteLength(out)).toBeLessThanOrEqual(37);
  });

  it("returns nothing for a budget of zero or less", () => {
    expect(truncateBytes("abc", 0)).toBe("");
    expect(truncateBytes("abc", -5)).toBe("");
  });
});

describe("capFieldMap", () => {
  it("keeps every field when the whole map fits", () => {
    expect(capFieldMap([["q", "hello"], ["note", "world"]], 100)).toEqual({ q: "hello", note: "world" });
  });

  it("charges keys as well as values against the budget", () => {
    // "q" + "hello" = 6 bytes exactly.
    expect(capFieldMap([["q", "hello"]], 6)).toEqual({ q: "hello" });
    expect(capFieldMap([["q", "hello"]], 5)).toEqual({ q: "hell" });
  });

  it("truncates the value that crosses the budget and drops what follows", () => {
    const out = capFieldMap([["a", "1234567"], ["b", "8"], ["c", "9"]], 8);
    // "a" + 7 bytes fills the budget; "b" and "c" never make it in.
    expect(out).toEqual({ a: "1234567" });
  });

  it("drops a field whose id alone will not fit rather than truncating the id", () => {
    // Half a DOM id addresses nothing, so the key is all-or-nothing.
    const out = capFieldMap([["short", "v"], ["a-very-long-element-id", "v"]], 10);
    expect(out).toEqual({ short: "v" });
  });

  it("holds a multi-byte field map inside the byte budget", () => {
    const out = capFieldMap([["notes", "漢".repeat(50_000)], ["q", "hi"]], MAX_INPUTS_LEN);
    expect(byteLength(JSON.stringify(out))).toBeLessThanOrEqual(MAX_INPUTS_LEN + 64);
    expect(hasLoneSurrogate(out.notes)).toBe(false);
  });

  it("returns an empty map for an empty field list", () => {
    expect(capFieldMap([], MAX_INPUTS_LEN)).toEqual({});
  });
});
