import { describe, it, expect } from "vitest";
import { frozenSystem, cacheLastTurn } from "./cache";

describe("cache helpers", () => {
  it("frozenSystem marks the system block ephemeral", () => {
    const sys = frozenSystem("hello");
    expect(sys[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("cacheLastTurn puts a breakpoint on the last block of the last message", () => {
    const msgs = cacheLastTurn([
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
    ]);
    const last: any = msgs[msgs.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content[last.content.length - 1].cache_control).toEqual({ type: "ephemeral" });
    // earlier message left untouched
    expect((msgs[0] as any).content).toBe("first");
  });

  it("returns empty array unchanged", () => {
    expect(cacheLastTurn([])).toEqual([]);
  });
});
